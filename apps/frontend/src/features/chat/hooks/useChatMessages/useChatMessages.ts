import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import type { Socket } from "socket.io-client"
import type { DisplayMessage } from "../../types"
import { encryptDmPlaintext, fetchFriendDmPublicKey, getDmSecretKey } from "../../dmE2ee"
import { encryptRoomPlaintext } from "../../roomE2ee"
import { createChatSocketHandlers } from "./createSocketHandlers"
import { DM_PLAIN_MAX, ROOM_PLAIN_MAX } from "./constants"
import { ensureRoomSymmetricKey } from "./ensureRoomSymmetricKey"
import { normalizeOutgoingContent } from "./rowDisplay"
import { usePeerDmPublicKeyPoller } from "./usePeerDmPublicKeyPoller"
import { useOutgoingMessages } from "./useOutgoingMessages"
import { useQueuedMessageSender } from "./useQueuedMessageSender"
import { MessageHistoryTracker } from "./messageHistoryTracker"

export type { VoiceSendMeta, AttachmentSendMeta } from "./types"

export function useChatMessages(
    socket: Socket | null,
    myName: string | null,
    myUserId: number | null,
    name: string,
    id: number,
    is_room: boolean,
    archived = false
) {
    const chatKey = `${is_room ? "room" : "dm"}:${id}`
    const scope = `${myUserId}:${chatKey}:${name}`
    const scopeRef = useRef(scope)
    scopeRef.current = scope
    const [stored, setStored] = useState<{ scope: string; messages: DisplayMessage[] }>({ scope, messages: [] })
    const storedMessages = stored.scope === scope ? stored.messages : []
    const storedMessagesRef = useRef(storedMessages)
    storedMessagesRef.current = storedMessages
    const setChatMessages = useCallback<Dispatch<SetStateAction<DisplayMessage[]>>>(
        (update) => {
            if (scopeRef.current !== scope) return
            setStored((previous) => {
                if (scopeRef.current !== scope) return previous
                const messages = previous.scope === scope ? previous.messages : []
                return { scope, messages: typeof update === "function" ? update(messages) : update }
            })
        },
        [scope]
    )
    const { outbox, chatMessages } = useOutgoingMessages(socket, myUserId, chatKey, storedMessages)
    const [historyLoading, setHistoryLoading] = useState(false)
    const [archivedPeer, setArchivedPeer] = useState({ scope, archived: false })
    const peerArchived = archivedPeer.scope === scope && archivedPeer.archived
    const [hasMore, setHasMore] = useState(false)
    const [olderLoading, setOlderLoading] = useState(false)
    const olderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [sendError, setSendError] = useState<string | null>(null)
    const [roomMembersEpoch, setRoomMembersEpoch] = useState(0)
    const [peerTyping, setPeerTyping] = useState<{ name: string } | null>(null)
    const [roomChatMeta, setRoomChatMeta] = useState<{ roomReadWatermark: number; pinnedMessageId: number | null }>({
        roomReadWatermark: 0,
        pinnedMessageId: null
    })
    const historyRef = useRef<MessageHistoryTracker | null>(null)
    const loadGenRef = useRef(0)
    const peerPubRef = useRef<string | null>(null)
    const typingSentRef = useRef(false)
    const typingIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    usePeerDmPublicKeyPoller(socket, is_room, name, peerPubRef, id)

    useEffect(() => {
        if (!peerTyping) return
        const t = window.setTimeout(() => setPeerTyping(null), 4500)
        return () => window.clearTimeout(t)
    }, [peerTyping])

    useEffect(() => {
        const g = ++loadGenRef.current
        const history = new MessageHistoryTracker()
        historyRef.current = history
        let latestLoad = 0
        let loadTimer: number | undefined
        setChatMessages([])
        setHasMore(false)
        setOlderLoading(false)
        setRoomChatMeta({ roomReadWatermark: 0, pinnedMessageId: null })
        setSendError(null)
        setPeerTyping(null)
        if (typingIdleRef.current) {
            clearTimeout(typingIdleRef.current)
            typingIdleRef.current = null
        }
        typingSentRef.current = false

        if (!socket || name === "Выберите пользователя") {
            setHistoryLoading(false)
            return
        }

        const runLoad = async () => {
            const attempt = ++latestLoad
            const requestId = crypto.randomUUID()
            setHistoryLoading(
                storedMessagesRef.current.length === 0 &&
                    !outbox?.getSnapshot().some((message) => message.chatKey === chatKey)
            )
            setOlderLoading(false)
            if (olderTimerRef.current) clearTimeout(olderTimerRef.current)
            window.clearTimeout(loadTimer)
            loadTimer = window.setTimeout(() => {
                if (loadGenRef.current !== g || latestLoad !== attempt) return
                history.cancel(requestId)
                latestLoad++
                setHistoryLoading(false)
                setSendError("История загружается дольше обычного. Проверьте соединение и откройте чат снова.")
            }, 15_000)
            if (is_room) await ensureRoomSymmetricKey(socket, id, myUserId, setSendError)
            if (loadGenRef.current !== g || latestLoad !== attempt) return
            history.beginLatest(
                requestId,
                storedMessagesRef.current.map((message) => message.id),
                (outbox?.getSnapshot() ?? [])
                    .filter((message) => message.chatKey === chatKey && message.serverId != null)
                    .map((message) => message.serverId!)
            )
            if (is_room) socket.emit("message:getMessages", { username: name, roomId: id, requestId })
            else socket.emit("message:getMessages", { username: name, peerUserId: id, requestId })
        }

        const {
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
        } = createChatSocketHandlers({
            socket,
            g,
            history,
            onHistoryReconciled: (confirmedIds) => outbox?.retireStored(confirmedIds),
            onDeletedMessage: (serverId) => outbox?.forgetDeleted(serverId),
            onPeerArchived: (archived) => setArchivedPeer({ scope, archived }),
            onHistoryLoaded: (more, older) => {
                if (!older) window.clearTimeout(loadTimer)
                if (olderTimerRef.current) clearTimeout(olderTimerRef.current)
                setHasMore(more)
                setOlderLoading(false)
            },
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
            onStoredMessage: (ciphertext, serverId) => outbox?.confirm(chatKey, ciphertext, serverId),
            onReadMessages: (ids) => outbox?.markRead(chatKey, ids),
            isMessageRead: (serverId) => outbox?.isRead(chatKey, serverId) ?? false,
            getOutgoingTimestamp: (clientId) => outbox?.createdAt(clientId)
        })

        const handleSendError = (p: { err?: string; clientMessageId?: string }) => {
            if (loadGenRef.current !== g || p.clientMessageId) return
            setSendError(typeof p?.err === "string" && p.err.length > 0 ? p.err : "Не удалось отправить сообщение")
        }

        const historyError = (p: { requestId?: string; err?: string }) => {
            if (loadGenRef.current !== g) return
            const accepted = history.accept(p.requestId)
            if (!accepted) return
            if (!accepted.older) {
                window.clearTimeout(loadTimer)
                setHistoryLoading(false)
            }
            setOlderLoading(false)
            setSendError(p.err || "Не удалось загрузить историю")
        }
        const peerUpdated = (event: { userId?: number; archived?: boolean }) => {
            if (!is_room && event.userId === id && event.archived === true && loadGenRef.current === g) {
                setArchivedPeer({ scope, archived: true })
                setPeerTyping(null)
            }
        }
        socket.on("profile:updated", peerUpdated)
        socket.on("connect", runLoad)
        socket.on("message:getMessages:error", historyError)
        socket.on("message:getMessages:success", handleGetMessages)
        socket.on("message:receive", handleReceiveMessage)
        socket.on("message:send:success", handleSendMessage)
        socket.on("message:send:error", handleSendError)
        socket.on("message:read", handlePeerRead)
        socket.on("message:deleted", handleDeleted)
        socket.on("room:e2eeNeedWrap", handleRoomNeedWrap)
        socket.on("room:membersChanged", handleRoomMembersChanged)
        socket.on("message:edited", handleMessageEdited)
        socket.on("message:reaction", handleMessageReaction)
        socket.on("chat:typing", handleChatTyping)
        socket.on("room:pinChanged", handleRoomPinChanged)
        socket.on("dm:pinChanged", handleDmPinChanged)
        socket.on("dmThreadOp:new", handleDmThreadOp)
        void runLoad()

        return () => {
            if (loadGenRef.current === g) loadGenRef.current = g + 1
            latestLoad++
            window.clearTimeout(loadTimer)
            if (historyRef.current === history) historyRef.current = null
            if (olderTimerRef.current) clearTimeout(olderTimerRef.current)
            socket.off("profile:updated", peerUpdated)
            socket.off("connect", runLoad)
            socket.off("message:getMessages:error", historyError)
            socket.off("message:getMessages:success", handleGetMessages)
            socket.off("message:receive", handleReceiveMessage)
            socket.off("message:send:success", handleSendMessage)
            socket.off("message:send:error", handleSendError)
            socket.off("message:read", handlePeerRead)
            socket.off("message:deleted", handleDeleted)
            socket.off("room:e2eeNeedWrap", handleRoomNeedWrap)
            socket.off("room:membersChanged", handleRoomMembersChanged)
            socket.off("message:edited", handleMessageEdited)
            socket.off("message:reaction", handleMessageReaction)
            socket.off("chat:typing", handleChatTyping)
            socket.off("room:pinChanged", handleRoomPinChanged)
            socket.off("dm:pinChanged", handleDmPinChanged)
            socket.off("dmThreadOp:new", handleDmThreadOp)
        }
    }, [socket, name, id, is_room, myName, myUserId, roomMembersEpoch, outbox, chatKey, setChatMessages, scope])

    const stopComposerTyping = useCallback(() => {
        if (!socket) return
        if (typingIdleRef.current) {
            clearTimeout(typingIdleRef.current)
            typingIdleRef.current = null
        }
        if (typingSentRef.current) {
            typingSentRef.current = false
            if (name !== "Выберите пользователя") {
                if (is_room) socket.emit("chat:typing", { roomId: id, typing: false })
                else socket.emit("chat:typing", { dmUsername: name, peerUserId: id, typing: false })
            }
        }
    }, [socket, is_room, id, name])

    const signalComposerTyping = useCallback(
        (hasText: boolean) => {
            if (!socket || name === "Выберите пользователя" || archived || peerArchived) return
            if (hasText) {
                if (!typingSentRef.current) {
                    typingSentRef.current = true
                    if (is_room) socket.emit("chat:typing", { roomId: id, typing: true })
                    else socket.emit("chat:typing", { dmUsername: name, peerUserId: id, typing: true })
                }
                if (typingIdleRef.current) clearTimeout(typingIdleRef.current)
                typingIdleRef.current = setTimeout(() => {
                    typingIdleRef.current = null
                    typingSentRef.current = false
                    if (is_room) socket.emit("chat:typing", { roomId: id, typing: false })
                    else socket.emit("chat:typing", { dmUsername: name, peerUserId: id, typing: false })
                }, 2800)
            } else {
                if (typingIdleRef.current) {
                    clearTimeout(typingIdleRef.current)
                    typingIdleRef.current = null
                }
                if (typingSentRef.current) {
                    typingSentRef.current = false
                    if (is_room) socket.emit("chat:typing", { roomId: id, typing: false })
                    else socket.emit("chat:typing", { dmUsername: name, peerUserId: id, typing: false })
                }
            }
        },
        [socket, is_room, id, name, archived, peerArchived]
    )

    const sendMessage = useQueuedMessageSender({
        socket,
        outbox,
        chatKey,
        name,
        id,
        isRoom: is_room,
        disabled: archived || peerArchived,
        myName,
        myUserId,
        messages: chatMessages,
        setError: setSendError,
        stopTyping: stopComposerTyping
    })

    const loadOlder = useCallback(() => {
        if (!socket?.connected || !is_room || historyLoading || olderLoading || !hasMore) return
        const ids = chatMessages.filter((message) => message.id > 0).map((message) => message.id)
        if (!ids.length) return
        const history = historyRef.current
        if (!history || history.hasLatest()) return
        setOlderLoading(true)
        const generation = loadGenRef.current
        const requestId = crypto.randomUUID()
        history.beginOlder(requestId)
        socket.emit("message:getMessages", { roomId: id, requestId, beforeId: Math.min(...ids) })
        olderTimerRef.current = setTimeout(() => {
            if (loadGenRef.current === generation) {
                history.cancel(requestId)
                setOlderLoading(false)
                setSendError("Не удалось загрузить предыдущие сообщения. Повторите попытку.")
            }
        }, 15_000)
    }, [socket, is_room, id, historyLoading, olderLoading, hasMore, chatMessages])

    const deleteMessageById = useCallback(
        (messageId: number) => {
            if (!socket) return
            stopComposerTyping()
            socket.emit("message:delete", { id: messageId })
        },
        [socket, stopComposerTyping]
    )

    const editMessage = useCallback(
        async (messageId: number, raw: string): Promise<boolean> => {
            if (archived || peerArchived) return false
            setSendError(null)
            const content = normalizeOutgoingContent(raw)
            if (content == null || !socket) return false
            if (is_room) {
                const sym = await ensureRoomSymmetricKey(socket, id, myUserId, setSendError)
                if (!sym) {
                    setSendError("Ключ комнаты ещё не готов. Подождите или обновите чат.")
                    return false
                }
                if (content.length > ROOM_PLAIN_MAX) {
                    setSendError(`Не более ${ROOM_PLAIN_MAX} символов`)
                    return false
                }
                let payload: string
                try {
                    payload = encryptRoomPlaintext(content, sym.key, sym.epoch)
                } catch {
                    setSendError("Ошибка шифрования")
                    return false
                }
                socket.emit("message:edit", { id: messageId, content: payload, roomId: id })
                stopComposerTyping()
                return true
            }
            const sk = getDmSecretKey(myUserId)
            if (!sk) {
                setSendError("Нет ключа шифрования. Обновите страницу.")
                return false
            }
            const peerPub = await fetchFriendDmPublicKey(socket, name, undefined, id)
            peerPubRef.current = peerPub
            if (!peerPub) {
                setSendError(
                    "Ключ собеседника недоступен или изменился. Проверьте уведомление о ключе; собеседник должен войти в приложение."
                )
                return false
            }
            if (content.length > DM_PLAIN_MAX) {
                setSendError(`Не более ${DM_PLAIN_MAX} символов`)
                return false
            }
            let payload: string
            try {
                payload = encryptDmPlaintext(content, peerPub, sk)
            } catch {
                setSendError("Ошибка шифрования")
                return false
            }
            socket.emit("message:edit", { id: messageId, content: payload, username: name, peerUserId: id })
            stopComposerTyping()
            return true
        },
        [socket, is_room, id, name, myUserId, stopComposerTyping, archived, peerArchived]
    )

    const toggleReaction = useCallback(
        (messageId: number, emoji: string) => {
            if (!socket || archived || peerArchived) return
            if (is_room) socket.emit("message:react", { messageId, emoji, roomId: id })
            else socket.emit("message:react", { messageId, emoji })
        },
        [socket, is_room, id, archived, peerArchived]
    )

    const fetchRoomReaders = useCallback(
        (messageId: number, callback: (readers: string[], err?: string) => void) => {
            if (!socket || !is_room) return
            socket.emit(
                "message:getRoomReaders",
                { roomId: id, messageId },
                (res: { readers?: string[]; err?: string }) => {
                    if (res?.err) callback([], res.err)
                    else callback(res?.readers || [], undefined)
                }
            )
        },
        [socket, is_room, id]
    )

    return {
        chatMessages,
        peerArchived,
        retryMessage: outbox?.retry,
        hasMore,
        olderLoading,
        loadOlder,
        historyLoading,
        sendMessage,
        sendError,
        deleteMessageById,
        fetchRoomReaders,
        editMessage,
        toggleReaction,
        signalComposerTyping,
        stopComposerTyping,
        peerTyping,
        roomChatMeta
    }
}
