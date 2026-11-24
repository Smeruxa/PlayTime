import { matchesDirectMessage, matchesPeer } from "../../../../identity/peerIdentity"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import type { Socket } from "socket.io-client"
import type { MessageType } from "../../../../types"
import type { DisplayMessage } from "../../types"
import { compareDisplayMessages } from "../../compareDisplayMessages"
import { mergeDisplayMessage } from "../../mergeDisplayMessage"
import { MessageHistoryTracker, type MessageUpdate } from "./messageHistoryTracker"
import { applyReactionEvent, withMessageReactions } from "../../reactionAggregate"
import { encryptDmRawBytes, getDmSecretKey } from "../../dmE2ee"
import { decryptRoomCiphertext, fetchRoomE2eeBundle, loadRoomSymKeyFromStorage, putRoomWraps, roomMessageEpoch, ROOM_E2EE_PREFIX } from "../../roomE2ee"
import { currentKeyUserId } from "../../keyVault"
import { checkMessageKey } from "../../peerKeyTrust"
import { ensureRoomSymmetricKey } from "./ensureRoomSymmetricKey"
import { VOICE_MESSAGE_LIST_LABEL } from "../../voiceConstants"
import { decryptLiveDm, rowToDisplay, wireToReplyRef, parseLiveAttachment, displayMedia } from "./rowDisplay"
import type { HistoryRow, LiveReceiveMessage } from "./types"

export type GetMessagesSuccessPayload = {
    messages: HistoryRow[]
    peerUserId?: number
    peerArchived?: boolean
    requestId?: string
    hasMore?: boolean
    beforeId?: number
    roomReadWatermark?: number
    pinnedMessageId?: number | null
}

export type ChatSocketHandlerDeps = {
    socket: Socket
    g: number
    history: MessageHistoryTracker
    onHistoryReconciled?: (confirmedOutgoingIds: ReadonlySet<number>) => void
    onDeletedMessage?: (serverId: number) => void
    onPeerArchived?: (archived: boolean) => void
    onHistoryLoaded?: (hasMore: boolean, older: boolean) => void
    loadGenRef: MutableRefObject<number>
    is_room: boolean
    id: number
    name: string
    myName: string | null
    myUserId: number | null
    setChatMessages: Dispatch<SetStateAction<DisplayMessage[]>>
    setHistoryLoading: Dispatch<SetStateAction<boolean>>
    setRoomMembersEpoch: Dispatch<SetStateAction<number>>
    peerPubRef: MutableRefObject<string | null>
    setPeerTyping: Dispatch<SetStateAction<{ name: string } | null>>
    setRoomChatMeta: Dispatch<SetStateAction<{ roomReadWatermark: number; pinnedMessageId: number | null }>>
    onStoredMessage?: (ciphertext: string, serverId: number) => string | undefined
    onReadMessages?: (ids: number[]) => void
    isMessageRead?: (serverId: number) => boolean
    getOutgoingTimestamp?: (clientId: string) => number | undefined
}

export function createChatSocketHandlers({
    socket,
    g,
    history,
    onHistoryReconciled,
    onDeletedMessage,
    onHistoryLoaded,
    onPeerArchived,
    loadGenRef,
    is_room,
    id,
    name,
    myName,
    myUserId,
    setChatMessages,
    setHistoryLoading,
    setRoomMembersEpoch,
    peerPubRef,
    setPeerTyping,
    setRoomChatMeta,
    onStoredMessage,
    onReadMessages,
    isMessageRead,
    getOutgoingTimestamp
}: ChatSocketHandlerDeps) {
    const applyLiveUpdate = (update: MessageUpdate) => {
        if (loadGenRef.current !== g) return
        history.record(update)
        setChatMessages(update)
    }

    const handleGetMessages = async (raw: HistoryRow[] | GetMessagesSuccessPayload) => {
        if (loadGenRef.current !== g) return
        const payload: GetMessagesSuccessPayload = Array.isArray(raw) ? { messages: raw } : raw
        if (!is_room && payload.peerUserId !== undefined && payload.peerUserId !== id) return
        if (!history.isPending(payload.requestId)) return
        if (is_room) {
            const epochs = new Set(payload.messages.filter(m => m.content.startsWith(ROOM_E2EE_PREFIX)).map(m => roomMessageEpoch(m.content)))
            for (const epoch of Array.from(epochs)) {
                if (!loadRoomSymKeyFromStorage(id, epoch)) await ensureRoomSymmetricKey(socket, id, myUserId, () => {}, epoch)
            }
            if (loadGenRef.current !== g) return
        }
        const accepted = history.accept(payload.requestId)
        if (!accepted) return
        if (!is_room) onPeerArchived?.(payload.peerArchived === true)
        const data = payload.messages
        onHistoryLoaded?.(!!payload.hasMore, accepted.older)
        if (!accepted.older && is_room) {
            setRoomChatMeta({
                roomReadWatermark: typeof payload.roomReadWatermark === "number" ? payload.roomReadWatermark : 0,
                pinnedMessageId:
                    payload.pinnedMessageId === undefined || payload.pinnedMessageId === null
                        ? null
                        : typeof payload.pinnedMessageId === "number"
                          ? payload.pinnedMessageId
                          : null
            })
        } else if (!accepted.older) {
            setRoomChatMeta({
                roomReadWatermark: 0,
                pinnedMessageId:
                    payload.pinnedMessageId === undefined || payload.pinnedMessageId === null
                        ? null
                        : typeof payload.pinnedMessageId === "number"
                          ? payload.pinnedMessageId
                          : null
            })
        }
        if (!is_room) {
            for (let i = data.length - 1; i >= 0; i--) {
                const m = data[i]
                if (!m.is_dm_e2ee) continue
                const pk = !m.me ? m.sender_dm_public_key : m.receiver_dm_public_key
                if (typeof pk === "string" && pk.length > 0) {
                    peerPubRef.current = pk
                    break
                }
            }
        }
        const loaded = data.map((m) => {
            const display = rowToDisplay(m, is_room, myName, is_room ? loadRoomSymKeyFromStorage(id, roomMessageEpoch(m.content)) : null, myUserId)
            const clientMessageId =
                (m.sender_id !== undefined ? m.sender_id === myUserId : m.me || m.sender_username === myName) ? onStoredMessage?.(m.content, m.id) : undefined
            return {
                ...display,
                data: clientMessageId ? (getOutgoingTimestamp?.(clientMessageId) ?? display.data) : display.data,
                read: !!m.read || !!isMessageRead?.(m.id),
                clientMessageId
            }
        })
        setChatMessages((previous) => accepted.merge(previous, loaded))
        if (!accepted.older) {
            onHistoryReconciled?.(accepted.confirmedOutgoingIds)
            setHistoryLoading(false)
        }
    }

    const openRoomMessage = async (content: string): Promise<string> => {
        if (!content.startsWith(ROOM_E2EE_PREFIX)) return content
        const epoch = roomMessageEpoch(content)
        const key = loadRoomSymKeyFromStorage(id, epoch) ??
            (await ensureRoomSymmetricKey(socket, id, myUserId, () => {}, epoch))?.key
        return key ? decryptRoomCiphertext(content, key) : "🔒 Защищено сквозным шифрованием"
    }

    const handleReceiveMessage = async (msg: LiveReceiveMessage) => {
        if (is_room) {
            if (msg.roomId !== id) return
            if (loadGenRef.current === g) setHistoryLoading(false)
            const mid = typeof msg.id === "number" ? msg.id : -Date.now()
            const ts = msg.created_at ? new Date(msg.created_at).getTime() : Date.now()
            const reply = wireToReplyRef(msg.reply ?? undefined)
            const text = msg.content.startsWith(ROOM_E2EE_PREFIX) ? await openRoomMessage(msg.content) : msg.content
            if (loadGenRef.current !== g) return
            const vk = (msg as { voiceStorageKey?: string | null }).voiceStorageKey
            const vd = (msg as { voiceDurationSec?: number | null }).voiceDurationSec
            const hasVoice = typeof vk === "string" && vk.length > 0
            const voice = hasVoice
                ? { key: vk as string, durationSec: typeof vd === "number" && Number.isFinite(vd) ? vd : 0 }
                : undefined
            const attachment = parseLiveAttachment(msg)
            const clientMessageId = (msg.sender_id !== undefined ? msg.sender_id === myUserId : msg.from === myName)
                ? onStoredMessage?.(msg.content, mid)
                : undefined
            applyLiveUpdate((prev) =>
                mergeDisplayMessage(prev, {
                    id: mid,
                    me: msg.sender_id !== undefined ? msg.sender_id === myUserId : msg.from === myName,
                    clientMessageId,
                    ...displayMedia(text, voice, attachment),
                    data: ts,
                    read: !!isMessageRead?.(mid),
                    editedAt: null,
                    from: msg.from,
                    ...(reply ? { reply } : {})
                })
            )
            socket.emit("message:markRoomRead", { roomId: id })
            return
        }
        if (!matchesDirectMessage(msg, id, myUserId, name, myName)) return
        if (loadGenRef.current === g) setHistoryLoading(false)
        const mid = typeof msg.id === "number" ? msg.id : -Date.now()
        const incomingFromPeer = msg.sender_id !== undefined ? msg.sender_id === id : msg.sender_username === name
        if (
            msg.is_dm_e2ee &&
            incomingFromPeer &&
            typeof msg.senderDmPublicKey === "string" &&
            msg.senderDmPublicKey.length > 0
        ) {
            peerPubRef.current = msg.senderDmPublicKey
        }
        const reply = wireToReplyRef(msg.reply ?? undefined)
        const text = decryptLiveDm(
            msg.content,
            msg.is_dm_e2ee,
            msg.senderDmPublicKey,
            msg.receiverDmPublicKey,
            msg.sender_username,
            myName,
            myUserId,
            msg.sender_id
        )
        const vkDm = (msg as { voiceStorageKey?: string | null }).voiceStorageKey
        const vdDm = (msg as { voiceDurationSec?: number | null }).voiceDurationSec
        const hasVoiceDm = typeof vkDm === "string" && vkDm.length > 0
        const voiceDm = hasVoiceDm
            ? { key: vkDm as string, durationSec: typeof vdDm === "number" && Number.isFinite(vdDm) ? vdDm : 0 }
            : undefined
        const attachmentDm = parseLiveAttachment(msg)
        const clientMessageId = (
            msg.sender_id !== undefined ? msg.sender_id === myUserId : msg.sender_username === myName
        )
            ? onStoredMessage?.(msg.content, mid)
            : undefined
        applyLiveUpdate((prev) =>
            mergeDisplayMessage(prev, {
                id: mid,
                me: msg.sender_id !== undefined ? msg.sender_id === myUserId : msg.sender_username === myName,
                clientMessageId,
                ...displayMedia(text, voiceDm, attachmentDm),
                data:
                    (clientMessageId ? getOutgoingTimestamp?.(clientMessageId) : undefined) ??
                    new Date(msg.created_at ?? Date.now()).getTime(),
                read: !!msg.read || !!isMessageRead?.(mid),
                editedAt: null,
                ...(reply ? { reply } : {})
            })
        )
        if (incomingFromPeer) socket.emit("message:markRead", { username: name, peerUserId: id })
    }

    const handleSendMessage = (msg: MessageType) => {
        if (is_room || loadGenRef.current !== g) return
        if (!matchesDirectMessage(msg, id, myUserId, name, myName)) return
        if (loadGenRef.current === g) setHistoryLoading(false)
        if (
            msg.is_dm_e2ee &&
            msg.receiver_username === name &&
            typeof msg.receiverDmPublicKey === "string" &&
            msg.receiverDmPublicKey.length > 0
        ) {
            peerPubRef.current = msg.receiverDmPublicKey
        }
        const reply = wireToReplyRef(msg.reply ?? undefined)
        const text = decryptLiveDm(
            msg.content,
            msg.is_dm_e2ee,
            msg.senderDmPublicKey,
            msg.receiverDmPublicKey,
            msg.sender_username,
            myName,
            myUserId,
            msg.sender_id
        )
        const vkS = msg.voiceStorageKey
        const vdS = msg.voiceDurationSec
        const hasVoiceS = typeof vkS === "string" && vkS.length > 0
        const voiceS = hasVoiceS
            ? { key: vkS as string, durationSec: typeof vdS === "number" && Number.isFinite(vdS) ? vdS : 0 }
            : undefined
        const attachmentS = parseLiveAttachment(msg)
        const clientMessageId = onStoredMessage?.(msg.content, msg.id)
        applyLiveUpdate((prev) =>
            mergeDisplayMessage(prev, {
                id: msg.id,
                me: true,
                clientMessageId,
                ...displayMedia(text, voiceS, attachmentS),
                data:
                    (clientMessageId ? getOutgoingTimestamp?.(clientMessageId) : undefined) ??
                    new Date(msg.created_at).getTime(),
                read: !!msg.read || !!isMessageRead?.(msg.id),
                editedAt: null,
                ...(reply ? { reply } : {})
            })
        )
    }

    const handleMessageEdited = async (msg: {
        id: number
        roomId?: number
        content: string
        edited_at: string
        is_dm_e2ee?: boolean
        sender_username?: string
        receiver_username?: string
        sender_id?: number
        receiver_id?: number
        senderDmPublicKey?: string | null
        receiverDmPublicKey?: string | null
    }) => {
        if (loadGenRef.current !== g) return
        const ts = msg.edited_at ? new Date(msg.edited_at).getTime() : Date.now()
        if (is_room) {
            if (msg.roomId !== id) return
            const text = msg.content.startsWith(ROOM_E2EE_PREFIX) ? await openRoomMessage(msg.content) : msg.content
            if (loadGenRef.current !== g) return
            applyLiveUpdate((prev) =>
                prev.map((m) => {
                    if (m.id !== msg.id) return m
                    const nextText = m.voice ? VOICE_MESSAGE_LIST_LABEL : text
                    return { ...m, text: nextText, editedAt: ts }
                })
            )
            return
        }
        if (!matchesDirectMessage(msg, id, myUserId, name, myName)) return
        const text = decryptLiveDm(
            msg.content,
            msg.is_dm_e2ee,
            msg.senderDmPublicKey,
            msg.receiverDmPublicKey,
            msg.sender_username,
            myName,
            myUserId,
            msg.sender_id
        )
        applyLiveUpdate((prev) =>
            prev.map((m) => {
                if (m.id !== msg.id) return m
                const nextText = m.voice ? VOICE_MESSAGE_LIST_LABEL : text
                return { ...m, text: nextText, editedAt: ts }
            })
        )
    }

    const handleMessageReaction = (p: {
        messageId: number
        roomId?: number
        dmPeer?: string
        peerUserId?: number
        sender_id?: number
        receiver_id?: number
        dmSenderUsername?: string
        dmReceiverUsername?: string
        username: string
        emoji: string
        active: boolean
    }) => {
        if (loadGenRef.current !== g) return
        if (is_room) {
            if (p.roomId !== id) return
        } else {
            if (p.sender_id !== undefined || p.receiver_id !== undefined) {
                if (!matchesDirectMessage(p, id, myUserId, name, myName)) return
            } else if (p.peerUserId !== undefined) {
                if (p.peerUserId !== id) return
            } else {
                const me = myName ?? ""
                const s = p.dmSenderUsername
                const r = p.dmReceiverUsername
                if (typeof s === "string" && typeof r === "string" && s.length > 0 && r.length > 0) {
                    const isThisDm = (name === s && me === r) || (name === r && me === s)
                    if (!isThisDm) return
                } else if (p.dmPeer !== name) {
                    return
                }
            }
        }
        applyLiveUpdate((prev) =>
            prev.map((m) => {
                if (m.id !== p.messageId) return m
                const r = m.reactions ?? []
                return withMessageReactions(m, applyReactionEvent(r, p.username, p.emoji, p.active))
            })
        )
    }

    const handleChatTyping = (p: {
        fromUsername?: string
        roomId?: number
        dmPeer?: string
        peerUserId?: number
        typing?: boolean
    }) => {
        if (loadGenRef.current !== g) return
        if (is_room) {
            if (p.roomId !== id) return
        } else {
            if (!matchesPeer(p.peerUserId, id, p.dmPeer, name)) return
        }
        if (!p.typing) {
            setPeerTyping(null)
            return
        }
        if (p.fromUsername && p.fromUsername !== myName) setPeerTyping({ name: p.fromUsername })
    }

    const handlePeerRead = (p: {
        readerUsername?: string
        readerUserId?: number
        peerUserId?: number
        messageIds?: number[]
    }) => {
        if (is_room) return
        if (!matchesPeer(p.readerUserId ?? p.peerUserId, id, p.readerUsername, name) || !Array.isArray(p.messageIds))
            return
        const idSet = new Set(p.messageIds)
        onReadMessages?.(p.messageIds)
        applyLiveUpdate((prev) => prev.map((m) => (idSet.has(m.id) ? { ...m, read: true } : m)))
    }

    const handleDeleted = (p: { id?: number; roomId?: number }) => {
        if (loadGenRef.current !== g) return
        if (typeof p.id !== "number") return
        if (is_room && p.roomId !== id) return
        onDeletedMessage?.(p.id)
        setRoomChatMeta((prev) => (prev.pinnedMessageId === p.id ? { ...prev, pinnedMessageId: null } : prev))
        applyLiveUpdate((prev) => prev.filter((m) => m.id !== p.id))
    }

    const handleRoomPinChanged = (p: { roomId?: number; messageId?: number | null }) => {
        if (loadGenRef.current !== g) return
        if (!is_room || p.roomId !== id) return
        const mid = p.messageId == null ? null : typeof p.messageId === "number" ? p.messageId : null
        setRoomChatMeta((prev) => ({ ...prev, pinnedMessageId: mid }))
    }

    const handleDmPinChanged = (p: { dmPeer?: string; peerUserId?: number; messageId?: number | null }) => {
        if (loadGenRef.current !== g) return
        if (is_room) return
        if (!matchesPeer(p.peerUserId, id, p.dmPeer, name)) return
        const mid = p.messageId == null ? null : typeof p.messageId === "number" ? p.messageId : null
        setRoomChatMeta((prev) => ({ ...prev, pinnedMessageId: mid }))
    }

    const handleRoomMembersChanged = (p: { roomId?: number }) => {
        if (!is_room || p.roomId !== id) return
        setRoomMembersEpoch((n) => n + 1)
    }

    const handleDmThreadOp = (p: {
        peerUsername?: string
        peerUserId?: number
        op?: { id: number; text: string; created_at: string }
    }) => {
        if (is_room || loadGenRef.current !== g) return
        if (!matchesPeer(p.peerUserId, id, p.peerUsername, name)) return
        const o = p.op
        if (!o || typeof o.id !== "number" || typeof o.text !== "string") return
        const ts = o.created_at ? new Date(o.created_at).getTime() : Date.now()
        applyLiveUpdate((prev) => {
            if (prev.some((m) => m.id === o.id)) return prev
            const item: DisplayMessage = {
                id: o.id,
                me: false,
                text: o.text,
                data: ts,
                isThreadOp: true
            }
            return [...prev, item].sort(compareDisplayMessages)
        })
    }

    const handleRoomNeedWrap = async (p: { roomId?: number; newUserId?: number; username?: string }) => {
        if (!is_room || p.roomId !== id) return
        const newId = typeof p.newUserId === "number" ? p.newUserId : 0
        if (!newId || newId === myUserId) return
        const sk = getDmSecretKey(myUserId)
        if (!sk || !myUserId) return
        const b = await fetchRoomE2eeBundle(socket, id)
        if (loadGenRef.current !== g || currentKeyUserId() !== myUserId || "err" in b) return
        const epoch = b.epoch ?? 0
        if (!b.wrapCount) { await ensureRoomSymmetricKey(socket, id, myUserId, () => {}); return }
        const sym = loadRoomSymKeyFromStorage(id, epoch)
        if (!sym) return
        const target = b.members.find((m) => m.id === newId)
        if (!target?.dmPublicKey || !checkMessageKey(target.id, target.dmPublicKey, target.username)) return
        try {
            const cipher = encryptDmRawBytes(sym, target.dmPublicKey, sk)
            const put = await putRoomWraps(socket, id, { [String(newId)]: cipher }, epoch)
            if (!put.ok) console.warn("room:e2ee put wrap", put.err)
        } catch (e) {
            console.warn("room:e2eeNeedWrap", e)
        }
    }

    return {
        handleGetMessages,
        handleReceiveMessage,
        handleSendMessage,
        handlePeerRead,
        handleDeleted,
        handleRoomMembersChanged,
        handleRoomNeedWrap,
        handleMessageEdited,
        handleMessageReaction,
        handleChatTyping,
        handleRoomPinChanged,
        handleDmPinChanged,
        handleDmThreadOp
    }
}
