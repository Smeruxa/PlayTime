import { mergeDirectCall, resolveDirectCallResponse } from "../../utils/directCallState"
import styles from "../../ui/chat/ChatShell.module.css"
import pinnedStyles from "../../ui/chat/PinnedBar.module.css"
import shared from "../../ui/chat/chatShared.module.css"
import { ProfileDrawer } from "../../ui/layout/ProfileDrawer"
import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react"
import { FaThumbtack } from "react-icons/fa"
import { API_BASE } from "../../config"
import type { MouseEvent as ReactMouseEvent } from "react"
import { UserProps } from "../../types"
import { useSessionSocket, useCallState } from "../../server/socketContext"
import RoomSettingsModal from "../RoomSettingsModal/RoomSettingsModal"
import AddMembersModal from "../AddMembersModal/AddMembersModal"
import { useChatMessages } from "../../features/chat/hooks/useChatMessages"
import { ArchivedConversationNotice } from "../../features/chat/components/ArchivedConversationNotice"
import { ChatHeader } from "../../features/chat/components/ChatHeader"
import { ChatMessageList } from "../../features/chat/components/ChatMessageList"
import { ChatComposer, type ChatVoiceRecorderUi } from "../../features/chat/components/ChatComposer"
import { MessageContextMenu } from "../../features/chat/components/MessageContextMenu"
import { RoomReadersPopover } from "../../features/chat/components/RoomReadersPopover"
import { ChatHistorySearch } from "../../features/chat/components/ChatHistorySearch"
import type { DisplayMessage, StartCallResponse } from "../../features/chat/types"
import { useChatComposerFocus } from "../../features/chat/hooks/useChatComposerFocus"
import { useCloseChatOverlaysOnOutsidePress } from "../../features/chat/hooks/useCloseChatOverlaysOnOutsidePress"
import { useDmPeerHeaderProfile } from "../../features/chat/hooks/useDmPeerHeaderProfile"
import { recordEmojisInText } from "../../features/chat/emoji/emojiUsageStorage"
import { ChatEmojiRichText } from "../../features/chat/components/ChatEmojiRichText"
import { useVoiceRecorder } from "../../features/chat/hooks/useVoiceRecorder"
import { VOICE_MESSAGE_PLAINTEXT } from "../../features/chat/voiceConstants"
import {
    dmWallpaperPanelStyle,
    loadDmWallpaper,
    saveDmWallpaper,
    type DmWallpaperState
} from "../../features/chat/dmWallpaperStorage"
import {
    parseDmWallpaperUpdate,
    requestDmWallpaper,
    setDmWallpaperOnServer,
    type DmWallpaperUpdatePayload
} from "../../features/chat/dmWallpaperSocket"
import { DmWallpaperImageBackdrop } from "../../features/chat/components/DmWallpaperImageBackdrop"
import { DmWallpaperModal } from "../../features/chat/components/DmWallpaperModal"
import { formatAttachmentLimit } from "../../features/chat/attachmentConstants"
import { isPeerNotifyMuted, togglePeerNotifyMuted } from "../../notificationPrefs"
import { encryptMedia, safeMediaMime } from "../../features/chat/mediaEncryption"

const chatDrafts = new Map<string, string>()

interface ChatProps extends UserProps {
    onRoomRename?: (roomId: number, newName: string) => void
}

export default function Chat({ name, is_room, id, archived = false, onRoomRename }: ChatProps) {
    const [input, setInput] = useState("")
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const [startCallError, setStartCallError] = useState<string | null>(null)

    const [showRoomSettings, setShowRoomSettings] = useState(false)
    const [showAddMembers, setShowAddMembers] = useState(false)

    const [replyTo, setReplyTo] = useState<DisplayMessage | null>(null)
    const [menu, setMenu] = useState<{ msg: DisplayMessage; x: number; y: number } | null>(null)
    const [readersPop, setReadersPop] = useState<{ x: number; y: number; list: string[] } | null>(null)
    const [searchQuery, setSearchQuery] = useState("")
    const [searchIndex, setSearchIndex] = useState(0)
    const [searchPanelOpen, setSearchPanelOpen] = useState(false)
    const [editingMessageId, setEditingMessageId] = useState<number | null>(null)
    const editingMessageIdRef = useRef(editingMessageId)
    editingMessageIdRef.current = editingMessageId
    const [voiceBusy, setVoiceBusy] = useState(false)
    const [voiceErr, setVoiceErr] = useState<string | null>(null)
    const [dmWallpaperOpen, setDmWallpaperOpen] = useState(false)
    const [dmWallpaper, setDmWallpaper] = useState<DmWallpaperState>({ kind: "none" })
    const [pinFlashMessageId, setPinFlashMessageId] = useState<number | null>(null)
    const [attachBusy, setAttachBusy] = useState(false)
    const [attachErr, setAttachErr] = useState<string | null>(null)
    const [notifyMuted, setNotifyMuted] = useState(false)
    const [profileDrawerOpen, setProfileDrawerOpen] = useState(false)

    const menuWrapRef = useRef<HTMLDivElement>(null)
    const readersWrapRef = useRef<HTMLDivElement>(null)
    const searchInputRef = useRef<HTMLInputElement>(null)
    const chatInnerRef = useRef<HTMLDivElement>(null)
    const dmPeerRef = useRef(id)

    const { socket, myName, myUserId, planLimits } = useSessionSocket()
    const { activeCall, setActiveCall } = useCallState()
    const draftKey = `${myUserId}:${is_room ? "room" : "dm"}:${id}:${name}`
    const activeDraftKeyRef = useRef(draftKey)
    activeDraftKeyRef.current = draftKey
    useLayoutEffect(() => {
        setInput(chatDrafts.get(draftKey) || "")
        setReplyTo(null)
        setEditingMessageId(null)
    }, [draftKey])
    const dmHeaderEnabled = !is_room && !!name && name !== "Выберите пользователя"
    const dmHeaderVisual = useDmPeerHeaderProfile(socket, name, dmHeaderEnabled, id, myUserId)
    const {
        chatMessages,
        peerArchived,
        retryMessage,
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
    } = useChatMessages(socket, myName, myUserId, name, id, is_room, archived)

    const readOnly = !is_room && (archived || peerArchived)

    const {
        phase: voicePhase,
        error: voiceRecordingError,
        recordingSec: voiceRecordingSec,
        previewUrl: voicePreviewUrl,
        previewBlob: voicePreviewBlob,
        previewDurationSec: voicePreviewDurationSec,
        startRecording,
        stopRecording,
        cancelRecording,
        cancelPreview,
        afterVoiceSent
    } = useVoiceRecorder(planLimits?.maxVoiceMessageSec ?? 120)

    useEffect(() => {
        cancelRecording()
        cancelPreview()
        setVoiceBusy(false)
        setVoiceErr(null)
        setAttachBusy(false)
        setAttachErr(null)
        setProfileDrawerOpen(false)
    }, [name, id, is_room, cancelRecording, cancelPreview])

    useEffect(() => {
        if (is_room || !name || name === "Выберите пользователя") {
            setNotifyMuted(false)
            return
        }
        setNotifyMuted(isPeerNotifyMuted(myUserId, id))
    }, [is_room, name, id, myUserId])

    useLayoutEffect(() => {
        dmPeerRef.current = id
    }, [id])

    useEffect(() => {
        if (is_room || !myName || !name || name === "Выберите пользователя") {
            setDmWallpaper({ kind: "none" })
            return
        }
        setDmWallpaper(loadDmWallpaper(myName, name, myUserId, id))
        if (!socket) return

        const peer = name
        const pull = () => {
            requestDmWallpaper(
                socket,
                peer,
                (ack) => {
                    if (dmPeerRef.current !== id) return
                    const st = ack.state
                    if (st) {
                        setDmWallpaper(st)
                        saveDmWallpaper(myName, name, st, myUserId, id)
                    }
                },
                id
            )
        }

        pull()
        socket.on("connect", pull)
        return () => {
            socket.off("connect", pull)
        }
    }, [is_room, myName, name, socket, id, myUserId])

    useEffect(() => {
        if (!socket || is_room) return
        const onUpd = (p: DmWallpaperUpdatePayload) => {
            const update = parseDmWallpaperUpdate(p)
            if (!update || update.peerUserId !== dmPeerRef.current) return
            setDmWallpaper(update.state)
            if (myName) saveDmWallpaper(myName, name, update.state, myUserId, id)
        }
        socket.on("dmWallpaper:update", onUpd)
        return () => {
            socket.off("dmWallpaper:update", onUpd)
        }
    }, [socket, is_room, myName, myUserId, name, id])

    const persistDmWallpaper = useCallback(
        async (state: DmWallpaperState) => {
            if (readOnly) return { err: "Гость вышел. Этот диалог доступен только для чтения." }
            if (!socket?.connected) return { err: "Нет соединения с сервером" }
            return await new Promise<{ err?: string }>((resolve) => {
                setDmWallpaperOnServer(socket, name, state, resolve, id)
            })
        },
        [socket, name, id, readOnly]
    )

    const sendVoiceRecording = useCallback(async () => {
        if (readOnly) return
        if (!voicePreviewBlob || voicePreviewDurationSec <= 0) return
        setVoiceBusy(true)
        setVoiceErr(null)
        try {
            const token = localStorage.getItem("token")
            if (!token) throw new Error("Сессия истекла — войдите снова")
            const fd = new FormData()
            const encrypted = await encryptMedia(voicePreviewBlob)
            fd.append("file", encrypted.blob, "voice.bin")
            fd.append("durationSec", String(voicePreviewDurationSec))
            const res = await fetch(`${API_BASE}/voice/upload`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "X-Playtime-Media-Format": "secretbox-v1" },
                body: fd
            })
            if (!res.ok) {
                let msg = "Не удалось загрузить аудио"
                try {
                    const j = (await res.json()) as { error?: string }
                    if (typeof j.error === "string" && j.error) msg = j.error
                } catch {
                }
                throw new Error(msg)
            }
            const data = (await res.json()) as { voiceKey?: string }
            if (!data.voiceKey) throw new Error("Нет voiceKey")
            const ok = await sendMessage(VOICE_MESSAGE_PLAINTEXT, replyTo?.id ?? null, {
                voiceKey: data.voiceKey,
                voiceDurationSec: voicePreviewDurationSec,
                media: {
                    kind: "voice",
                    storageKey: data.voiceKey,
                    key: encrypted.key,
                    nonce: encrypted.nonce,
                    mime: safeMediaMime(voicePreviewBlob.type),
                    filename: voicePreviewBlob.type.startsWith("audio/mp4")
                        ? "voice.m4a"
                        : voicePreviewBlob.type.startsWith("audio/ogg")
                          ? "voice.ogg"
                          : "voice.webm",
                    sizeBytes: voicePreviewBlob.size,
                    durationSec: voicePreviewDurationSec
                }
            })
            if (!ok) throw new Error("Сообщение не отправлено")
            afterVoiceSent()
            setReplyTo(null)
        } catch (e) {
            setVoiceErr(e instanceof Error ? e.message : "Ошибка")
        } finally {
            setVoiceBusy(false)
        }
    }, [voicePreviewBlob, voicePreviewDurationSec, sendMessage, replyTo, afterVoiceSent, readOnly])

    const sendAttachment = useCallback(
        async (file: File) => {
            if (readOnly) return
            const maxBytes = planLimits?.maxAttachmentBytes ?? 512 * 1024
            if (file.size > maxBytes) {
                setAttachErr(`Файл больше лимита (${formatAttachmentLimit(maxBytes)})`)
                return
            }
            setAttachBusy(true)
            setAttachErr(null)
            try {
                const token = localStorage.getItem("token")
                if (!token) throw new Error("Сессия истекла — войдите снова")
                const fd = new FormData()
                const encrypted = await encryptMedia(file)
                fd.append("file", encrypted.blob, "attachment.bin")
                const res = await fetch(`${API_BASE}/attachments/upload`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}`, "X-Playtime-Media-Format": "secretbox-v1" },
                    body: fd
                })
                if (!res.ok) {
                    let msg = "Не удалось загрузить файл"
                    try {
                        const j = (await res.json()) as { error?: string }
                        if (typeof j.error === "string" && j.error) msg = j.error
                    } catch {
                    }
                    throw new Error(msg)
                }
                const data = (await res.json()) as {
                    attachmentKey?: string
                    mime?: string
                    filename?: string
                    sizeBytes?: number
                }
                if (!data.attachmentKey) throw new Error("Нет attachmentKey")
                const ok = await sendMessage("", replyTo?.id ?? null, undefined, {
                    attachmentKey: data.attachmentKey,
                    attachmentMime: data.mime || file.type || "application/octet-stream",
                    attachmentFilename: data.filename || file.name,
                    attachmentSize: data.sizeBytes ?? encrypted.blob.size,
                    media: {
                        kind: "attachment",
                        storageKey: data.attachmentKey,
                        key: encrypted.key,
                        nonce: encrypted.nonce,
                        mime: safeMediaMime(file.type),
                        filename: file.name.slice(0, 200),
                        sizeBytes: file.size
                    }
                })
                if (!ok) throw new Error("Сообщение не отправлено")
                setReplyTo(null)
            } catch (e) {
                setAttachErr(e instanceof Error ? e.message : "Ошибка")
            } finally {
                setAttachBusy(false)
            }
        },
        [planLimits?.maxAttachmentBytes, sendMessage, replyTo, readOnly]
    )

    const voiceRecorderUi: ChatVoiceRecorderUi = useMemo(
        () => ({
            phase: voicePhase,
            recordingSec: voiceRecordingSec,
            previewUrl: voicePreviewUrl,
            previewDurationSec: voicePreviewDurationSec,
            busy: voiceBusy,
            chatDisabled: readOnly || name === "Выберите пользователя" || !id || historyLoading,
            onMic: () => {
                setVoiceErr(null)
                void startRecording()
            },
            onStopRecord: () => stopRecording(),
            onCancelRecord: () => {
                cancelRecording()
                setVoiceErr(null)
            },
            onSendVoice: () => void sendVoiceRecording(),
            onCancelPreview: () => {
                cancelPreview()
                setVoiceErr(null)
            }
        }),
        [
            readOnly,
            voicePhase,
            voiceRecordingSec,
            voicePreviewUrl,
            voicePreviewDurationSec,
            voiceBusy,
            name,
            id,
            historyLoading,
            startRecording,
            stopRecording,
            cancelRecording,
            cancelPreview,
            sendVoiceRecording
        ]
    )

    const searchQ = searchQuery.trim().toLowerCase()
    const searchMatchIds = useMemo(() => {
        if (!searchQ) return []
        const asc = [...chatMessages].sort((a, b) => a.data - b.data)
        return asc.filter((m) => m.text.toLowerCase().includes(searchQ)).map((m) => m.id)
    }, [chatMessages, searchQ])
    const searchMatchCount = searchMatchIds.length
    const searchHighlightId = searchMatchCount > 0 ? searchMatchIds[Math.min(searchIndex, searchMatchCount - 1)] : null

    const pinnedSnippet = useMemo(() => {
        if (roomChatMeta.pinnedMessageId == null) return null
        const m = chatMessages.find((x) => x.id === roomChatMeta.pinnedMessageId)
        if (!m) return "Сообщение недоступно в истории"
        const t = m.text.replace(/\s+/g, " ").trim()
        return t.length > 90 ? t.slice(0, 89) + "…" : t || "…"
    }, [roomChatMeta.pinnedMessageId, chatMessages])

    useEffect(() => {
        if (pinFlashMessageId == null) return
        const t = window.setTimeout(() => setPinFlashMessageId(null), 2800)
        return () => window.clearTimeout(t)
    }, [pinFlashMessageId])

    const scrollToPinnedMessage = useCallback(() => {
        const mid = roomChatMeta.pinnedMessageId
        if (mid == null) return
        setPinFlashMessageId(mid)
        const root = chatInnerRef.current
        if (!root) return
        const el = root.querySelector<HTMLElement>(`[data-msg-id="${mid}"]`)
        requestAnimationFrame(() => {
            el?.scrollIntoView({ block: "center", behavior: "smooth" })
        })
    }, [roomChatMeta.pinnedMessageId])

    useEffect(() => {
        setSearchIndex(0)
    }, [searchQ])

    useEffect(() => {
        if (searchMatchCount === 0) {
            setSearchIndex(0)
            return
        }
        setSearchIndex((i) => Math.min(i, searchMatchCount - 1))
    }, [searchMatchCount, searchQ])

    useEffect(() => {
        setStartCallError(null)
        setReplyTo(null)
        setMenu(null)
        setReadersPop(null)
        setSearchQuery("")
        setSearchIndex(0)
        setSearchPanelOpen(false)
        setEditingMessageId(null)
        setVoiceErr(null)
    }, [name, id, is_room])

    useLayoutEffect(() => {
        if (!searchPanelOpen) return
        searchInputRef.current?.focus({ preventScroll: true })
    }, [searchPanelOpen])

    useChatComposerFocus(inputRef, name, id, is_room, replyTo)

    const dismissOverlays = useCallback(() => {
        setMenu(null)
        setReadersPop(null)
    }, [])
    useCloseChatOverlaysOnOutsidePress(menuWrapRef, readersWrapRef, dismissOverlays)

    const startRoomVoice = () => {
        if (!name || name === "Выберите пользователя" || !id || !myName) return
        if (activeCall && !activeCall.isParty) return
        setActiveCall({
            names: [name, myName],
            roomId: id,
            incoming: false,
            isParty: true
        })
    }

    const onInputChange = useCallback(
        (v: string) => {
            if (v) chatDrafts.set(draftKey, v)
            else chatDrafts.delete(draftKey)
            setInput(v)
            signalComposerTyping(v.trim().length > 0)
        },
        [signalComposerTyping, draftKey]
    )

    const onSend = useCallback(async () => {
        if (readOnly) return
        if (editingMessageId != null) {
            const key = draftKey
            if (!(await editMessage(editingMessageId, input))) return
            if (
                activeDraftKeyRef.current !== key ||
                editingMessageIdRef.current !== editingMessageId ||
                inputRef.current?.value !== input
            )
                return
            setEditingMessageId(null)
            setInput("")
            return
        }
        const text = input
        const key = draftKey
        if (!(await sendMessage(text, replyTo?.id ?? null))) return
        recordEmojisInText(text)
        if (chatDrafts.get(key) === text) chatDrafts.delete(key)
        if (activeDraftKeyRef.current !== key) return
        setReplyTo(null)
        setInput((current) => (current === text ? "" : current))
        inputRef.current?.focus()
    }, [editingMessageId, editMessage, input, replyTo, sendMessage, draftKey, readOnly])

    const startCall = () => {
        if (readOnly) return
        if (!name || !socket || name === "Выберите пользователя" || !myName) return
        if (activeCall && !activeCall.isParty) return
        socket.emit("call:start", { username: name, peerUserId: id }, (res: StartCallResponse) => {
            if (res?.success && res.roomId) {
                const next = resolveDirectCallResponse(res.state, myUserId!, {
                    names: [name, myName],
                    participantIds: [id, myUserId!],
                    roomId: res.roomId,
                    incoming: false,
                    confirmed: res.confirmed ?? false
                })
                if (next) setActiveCall((prev) => mergeDirectCall(prev, next))
                setStartCallError(null)
            } else {
                setStartCallError(res?.err || "Unknown error")
                console.error(res?.err || "Unknown error")
            }
        })
    }

    const onMessageContextMenu = useCallback((e: ReactMouseEvent, m: DisplayMessage) => {
        if (m.isThreadOp) return
        e.preventDefault()
        setReadersPop(null)
        setMenu({ msg: m, x: e.clientX, y: e.clientY })
    }, [])

    const showE2eeShield = !!(socket && name && name !== "Выберите пользователя")
    const showHistorySearch = id > 0 && name !== "Выберите пользователя"

    const dmChatPanelStyle = useMemo(() => {
        if (is_room) return undefined
        return dmWallpaperPanelStyle(dmWallpaper)
    }, [is_room, dmWallpaper])

    const onToggleSearchPanel = useCallback(() => {
        setSearchPanelOpen((open) => {
            if (open) {
                setSearchQuery("")
                setSearchIndex(0)
                return false
            }
            return true
        })
    }, [])

    return (
        <div className={styles.body}>
            <ChatHeader
                archived={readOnly}
                name={name}
                is_room={is_room}
                startCallError={startCallError}
                onStartCall={startCall}
                onStartRoomVoice={startRoomVoice}
                onOpenRoomSettings={() => setShowRoomSettings(true)}
                onOpenFriendProfile={
                    !is_room && name && name !== "Выберите пользователя"
                        ? () => setProfileDrawerOpen((open) => !open)
                        : undefined
                }
                showE2eeShield={showE2eeShield}
                peerTypingName={peerTyping?.name}
                showSearchToggle={showHistorySearch}
                searchOpen={searchPanelOpen}
                onToggleSearch={onToggleSearchPanel}
                onOpenDmWallpaper={
                    !is_room && myName && name && name !== "Выберите пользователя"
                        ? () => setDmWallpaperOpen(true)
                        : undefined
                }
                notifyMuted={!is_room && name !== "Выберите пользователя" ? notifyMuted : undefined}
                onToggleNotifyMute={
                    !is_room && name && name !== "Выберите пользователя"
                        ? () => {
                              const next = myUserId == null ? false : togglePeerNotifyMuted(myUserId, id)
                              setNotifyMuted(next)
                          }
                        : undefined
                }
                dmHeaderVisual={dmHeaderEnabled ? dmHeaderVisual : undefined}
            />
            {sendError ? <div className={styles.sendErrorBanner}>{sendError}</div> : null}
            {voiceErr ? <div className={styles.sendErrorBanner}>{voiceErr}</div> : null}
            {voiceRecordingError ? (
                <div className={styles.sendErrorBanner} role="alert">
                    {voiceRecordingError}
                </div>
            ) : null}
            {attachErr ? <div className={styles.sendErrorBanner}>{attachErr}</div> : null}
            {showHistorySearch ? (
                <div
                    className={`${styles.chatHistorySearchShell} ${
                        searchPanelOpen ? styles.chatHistorySearchShellOpen : ""
                    }`}
                    aria-hidden={!searchPanelOpen}
                >
                    <div className={styles.chatHistorySearchShellInner} inert={!searchPanelOpen || undefined}>
                        <ChatHistorySearch
                            ref={searchInputRef}
                            value={searchQuery}
                            onChange={setSearchQuery}
                            matchIndex={searchIndex}
                            matchCount={searchMatchCount}
                            onPrev={() => {
                                if (searchMatchCount < 1) return
                                setSearchIndex((i) => (i - 1 + searchMatchCount) % searchMatchCount)
                            }}
                            onNext={() => {
                                if (searchMatchCount < 1) return
                                setSearchIndex((i) => (i + 1) % searchMatchCount)
                            }}
                        />
                    </div>
                </div>
            ) : null}
            <div className={styles.chatRow}>
                <div className={styles.chatPanel} style={dmChatPanelStyle}>
                    {!is_room && dmWallpaper.kind === "image" ? (
                        <DmWallpaperImageBackdrop
                            dataUrl={dmWallpaper.dataUrl}
                            dim={dmWallpaper.dim}
                            blur={dmWallpaper.blur}
                        />
                    ) : null}
                    <div ref={chatInnerRef} className={styles.chatInner}>
                        {roomChatMeta.pinnedMessageId != null && pinnedSnippet ? (
                            <button
                                type="button"
                                className={pinnedStyles.chatPinnedBar}
                                onClick={scrollToPinnedMessage}
                                title="Перейти к закреплённому сообщению"
                            >
                                <span className={pinnedStyles.chatPinnedBarIconWrap} aria-hidden>
                                    <FaThumbtack className={pinnedStyles.chatPinnedBarIcon} />
                                </span>
                                <span className={pinnedStyles.chatPinnedBarBody}>
                                    <span className={pinnedStyles.chatPinnedBarLabel}>Закреплено</span>
                                    <span className={pinnedStyles.chatPinnedBarText}>
                                        <ChatEmojiRichText text={pinnedSnippet} imgClassName={shared.chatEmojiInline} />
                                    </span>
                                </span>
                            </button>
                        ) : null}
                        <ChatMessageList
                            messages={chatMessages}
                            hasMore={hasMore}
                            olderLoading={olderLoading}
                            onLoadOlder={loadOlder}
                            is_room={is_room}
                            loading={historyLoading}
                            onMessageContextMenu={onMessageContextMenu}
                            highlightMessageId={searchHighlightId}
                            pinFlashMessageId={pinFlashMessageId}
                            myName={myName}
                            onToggleReaction={toggleReaction}
                            roomReadWatermark={is_room ? roomChatMeta.roomReadWatermark : 0}
                            onRetryMessage={readOnly ? undefined : retryMessage}
                        />
                        {readOnly ? (
                            <ArchivedConversationNotice />
                        ) : (
                            <ChatComposer
                                disabled={readOnly}
                                inputRef={inputRef}
                                value={input}
                                onChange={onInputChange}
                                onSend={onSend}
                                replyTo={replyTo}
                                onCancelReply={() => setReplyTo(null)}
                                maxLen={2000}
                                editingMessageId={editingMessageId}
                                onCancelEdit={() => {
                                    setEditingMessageId(null)
                                    setInput("")
                                    stopComposerTyping()
                                }}
                                onStopComposerTyping={stopComposerTyping}
                                voiceRecorder={voiceRecorderUi}
                                attachBusy={attachBusy}
                                attachDisabled={readOnly || name === "Выберите пользователя" || !id || historyLoading}
                                onAttachFile={(file) => void sendAttachment(file)}
                            />
                        )}
                    </div>
                </div>
                {!is_room && name && name !== "Выберите пользователя" ? (
                    <ProfileDrawer
                        open={profileDrawerOpen}
                        username={name}
                        peerUserId={id}
                        onClose={() => setProfileDrawerOpen(false)}
                    />
                ) : null}
            </div>
            {menu ? (
                <div ref={menuWrapRef}>
                    <MessageContextMenu
                        readOnly={readOnly}
                        message={menu.msg}
                        is_room={is_room}
                        clientX={menu.x}
                        clientY={menu.y}
                        onClose={() => setMenu(null)}
                        onReply={() => {
                            setReplyTo(menu.msg)
                            setMenu(null)
                        }}
                        onEdit={() => {
                            setEditingMessageId(menu.msg.id)
                            setInput(menu.msg.text)
                            setReplyTo(null)
                            setMenu(null)
                        }}
                        onReact={(em) => {
                            toggleReaction(menu.msg.id, em)
                            setMenu(null)
                        }}
                        onDelete={() => {
                            deleteMessageById(menu.msg.id)
                            setMenu(null)
                        }}
                        onWhoRead={
                            is_room
                                ? () => {
                                      const px = menu.x
                                      const py = menu.y
                                      const mid = menu.msg.id
                                      fetchRoomReaders(mid, (list) => {
                                          setMenu(null)
                                          setReadersPop({ x: px, y: py, list })
                                      })
                                  }
                                : undefined
                        }
                        pinnedMessageId={roomChatMeta.pinnedMessageId}
                        onSetPin={
                            socket && name !== "Выберите пользователя"
                                ? (messageId) => {
                                      if (is_room) socket.emit("room:setPin", { roomId: id, messageId })
                                      else socket.emit("dm:setPin", { dmUsername: name, peerUserId: id, messageId })
                                  }
                                : undefined
                        }
                    />
                </div>
            ) : null}
            {readersPop ? (
                <div ref={readersWrapRef}>
                    <RoomReadersPopover
                        clientX={readersPop.x}
                        clientY={readersPop.y}
                        readers={readersPop.list}
                        onClose={() => setReadersPop(null)}
                    />
                </div>
            ) : null}
            {is_room && showRoomSettings && (
                <RoomSettingsModal
                    roomId={id}
                    currentName={name}
                    onClose={() => setShowRoomSettings(false)}
                    onRename={(newName) => onRoomRename?.(id, newName)}
                    onOpenAddMembers={() => setShowAddMembers(true)}
                />
            )}
            {is_room && showAddMembers && <AddMembersModal roomId={id} onClose={() => setShowAddMembers(false)} />}
            {!is_room && myName && name && name !== "Выберите пользователя" ? (
                <DmWallpaperModal
                    open={dmWallpaperOpen}
                    myUsername={myName}
                    peerUsername={name}
                    ownerId={myUserId}
                    peerUserId={id}
                    currentWallpaper={dmWallpaper}
                    persistWallpaper={persistDmWallpaper}
                    onClose={() => setDmWallpaperOpen(false)}
                    onApplied={(s) => setDmWallpaper(s)}
                />
            ) : null}
        </div>
    )
}
