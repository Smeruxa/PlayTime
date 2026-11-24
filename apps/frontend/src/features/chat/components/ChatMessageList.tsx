import { Fragment, useLayoutEffect, useRef, useState, useEffect, useCallback } from "react"
import type { MouseEvent } from "react"
import { MessageDeliveryStatus } from "./MessageDeliveryStatus"
import type { DisplayMessage } from "../types"
import { compareDisplayMessages } from "../compareDisplayMessages"
import { formatChatTime } from "../formatChatTime"
import { getChatDate } from "../formatChatDate"
import { areMessagesGrouped } from "../groupChatMessages"
import { ChatMessagesSkeleton } from "./ChatMessagesSkeleton"
import { ChatEmojiRichText } from "./ChatEmojiRichText"
import { ChatEmojiImg } from "./ChatEmojiImg"
import { VoiceMessagePlayer } from "./VoiceMessagePlayer"
import { ChatAttachmentBubble } from "./ChatAttachmentBubble"
import styles from "../../../ui/chat/MessageBubble.module.css"
import shared from "../../../ui/chat/chatShared.module.css"

type ChatMessageListProps = {
    messages: DisplayMessage[]
    hasMore?: boolean
    olderLoading?: boolean
    onLoadOlder?: () => void
    is_room: boolean
    loading?: boolean
    onMessageContextMenu: (e: MouseEvent, m: DisplayMessage) => void
    highlightMessageId?: number | null
    pinFlashMessageId?: number | null
    myName: string | null
    onToggleReaction: (messageId: number, emoji: string) => void
    roomReadWatermark?: number
    onRetryMessage?: (clientId: string) => void
}

const SKEL_FADE_MS = 300
type MessageIdentity = string | number
const messageIdentity = (message: DisplayMessage): MessageIdentity => message.clientMessageId ?? message.id

export function ChatMessageList({
    messages,
    hasMore = false,
    olderLoading = false,
    onLoadOlder,
    is_room,
    loading = false,
    onMessageContextMenu,
    highlightMessageId = null,
    pinFlashMessageId = null,
    myName,
    onToggleReaction,
    roomReadWatermark = 0,
    onRetryMessage
}: ChatMessageListProps) {
    const scrollRef = useRef<HTMLDivElement>(null)
    const prevLenRef = useRef(0)
    const newestIdRef = useRef<MessageIdentity | null>(null)
    const prevMessageIdsRef = useRef<Set<MessageIdentity>>(new Set())
    const [enteringMessageIds, setEnteringMessageIds] = useState<Set<MessageIdentity>>(() => new Set())
    const [showSkeletonOverlay, setShowSkeletonOverlay] = useState(loading)

    const clearEnteringId = useCallback((id: MessageIdentity) => {
        setEnteringMessageIds((prev) => {
            if (!prev.has(id)) return prev
            const next = new Set(prev)
            next.delete(id)
            return next
        })
    }, [])

    useEffect(() => {
        if (loading) {
            setShowSkeletonOverlay(true)
            return
        }
        const id = window.setTimeout(() => setShowSkeletonOverlay(false), SKEL_FADE_MS)
        return () => window.clearTimeout(id)
    }, [loading])

    useLayoutEffect(() => {
        const prev = prevMessageIdsRef.current
        const currIds = messages.map(messageIdentity)
        const currSet = new Set(currIds)
        const added = currIds.filter((id) => !prev.has(id))
        prevMessageIdsRef.current = currSet

        setEnteringMessageIds((p) => {
            let next = new Set<MessageIdentity>()
            p.forEach((id) => {
                if (currSet.has(id)) next.add(id)
            })
            if (loading) return new Set()
            const firstPopulation = prev.size === 0 && added.length > 0
            const fullReplace = prev.size > 0 && currSet.size > 0 && added.length === currSet.size
            if (firstPopulation || fullReplace) return new Set()
            const reduceMotion =
                typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
            if (added.length > 0 && !reduceMotion) {
                next = new Set(next)
                for (const id of added) next.add(id)
            }
            return next
        })
    }, [messages, loading])

    useLayoutEffect(() => {
        if (messages.length === 0) {
            prevLenRef.current = 0
            return
        }
        const asc = [...messages].sort(compareDisplayMessages)
        const newest = asc[asc.length - 1]
        const prev = prevLenRef.current
        prevLenRef.current = messages.length
        const newestChanged = newestIdRef.current !== messageIdentity(newest)
        newestIdRef.current = messageIdentity(newest)
        const grew = messages.length > prev && newestChanged
        const initialFill = prev === 0 && messages.length > 0
        if (!initialFill && !(grew && (newest?.me || newest?.isThreadOp))) return
        const pinToNewest = () => {
            const wrap = scrollRef.current
            if (!wrap) return
            wrap.scrollTop = 0
        }
        requestAnimationFrame(() => {
            requestAnimationFrame(pinToNewest)
        })
    }, [messages])

    useLayoutEffect(() => {
        if (highlightMessageId == null) return
        const root = scrollRef.current
        if (!root) return
        const el = root.querySelector<HTMLElement>(`[data-msg-id="${highlightMessageId}"]`)
        if (!el) return
        el.scrollIntoView({ block: "nearest", behavior: "smooth" })
    }, [highlightMessageId, messages.length])

    const reversed = messages.slice().reverse()

    return (
        <div ref={scrollRef} className={styles.messages}>
            <div className={styles.messagesBottomSpacer} aria-hidden />
            {reversed.map((m, i) => {
                const older = reversed[i + 1]
                const date = getChatDate(m.data)
                const startsDay = date != null && (!older || date.key !== getChatDate(older.data)?.key)
                const dateDivider =
                    startsDay && date ? (
                        <div className={styles.dateDivider} role="separator" aria-label={`Сообщения за ${date.label}`}>
                            <time dateTime={date.key}>{date.label}</time>
                        </div>
                    ) : null
                if (m.isThreadOp) {
                    const playEnter = enteringMessageIds.has(m.id)
                    return (
                        <Fragment key={`thread-${m.id}`}>
                            <div
                                className={`${styles.threadOpRow} ${playEnter ? styles.threadOpRowEnter : ""}`}
                                onAnimationEnd={(e) => {
                                    if (e.target !== e.currentTarget) return
                                    clearEnteringId(m.id)
                                }}
                            >
                                <span className={styles.threadOpText}>{m.text}</span>
                            </div>
                            {dateDivider}
                        </Fragment>
                    )
                }
                const showNewDivider =
                    is_room &&
                    roomReadWatermark > 0 &&
                    m.id > roomReadWatermark &&
                    older != null &&
                    !older.isThreadOp &&
                    older.id <= roomReadWatermark
                const newer = reversed[i - 1]
                const groupedWithOlder = areMessagesGrouped(m, older, is_room) && !showNewDivider
                const groupedWithNewer =
                    areMessagesGrouped(m, newer, is_room) &&
                    !(is_room && roomReadWatermark > 0 && m.id <= roomReadWatermark && newer.id > roomReadWatermark)
                const showRoomAuthor = is_room && !m.me && !groupedWithOlder
                const playEnter = enteringMessageIds.has(messageIdentity(m))
                const enterClass = m.me ? styles.msgRowEnterMine : styles.msgRowEnterOther
                return (
                    <Fragment key={`msg-${m.clientMessageId ?? m.id}`}>
                        <div
                            className={`${styles.msgRow} ${m.me ? styles.msgRowMine : styles.msgRowOther} ${!groupedWithOlder && !startsDay ? styles.msgRowGroupStart : ""} ${playEnter ? enterClass : ""}`}
                            onAnimationEnd={(e) => {
                                if (e.target !== e.currentTarget) return
                                clearEnteringId(messageIdentity(m))
                            }}
                        >
                            <div className={styles.bubbleCol}>
                                {showRoomAuthor ? <div className={styles.roomAuthor}>{m.from}</div> : null}
                                <div
                                    data-msg-id={m.id}
                                    data-client-message-id={m.clientMessageId}
                                    className={`${styles.bubble} ${m.me ? styles.bubbleMine : styles.bubbleOther} ${!groupedWithNewer ? styles.bubbleGroupEnd : ""} ${m.voice ? styles.bubbleVoice : ""} ${
                                        highlightMessageId != null && m.id === highlightMessageId
                                            ? styles.bubbleSearchHighlight
                                            : ""
                                    } ${pinFlashMessageId != null && m.id === pinFlashMessageId ? styles.bubblePinFlash : ""}`}
                                    onContextMenu={(e) => {
                                        if (m.id > 0) onMessageContextMenu(e, m)
                                    }}
                                >
                                    {m.reply ? (
                                        <div className={styles.bubbleReply}>
                                            <span className={styles.bubbleReplyAuthor}>{m.reply.author}</span>
                                            <span className={styles.bubbleReplyText}>
                                                <ChatEmojiRichText
                                                    text={m.reply.preview}
                                                    imgClassName={shared.chatEmojiInline}
                                                />
                                            </span>
                                        </div>
                                    ) : null}
                                    <div
                                        className={`${styles.bubbleText} ${m.voice || m.attachment ? styles.bubbleMedia : ""}`}
                                    >
                                        {m.voice ? (
                                            <VoiceMessagePlayer
                                                voiceKey={m.voice.key}
                                                durationSec={m.voice.durationSec}
                                                mine={m.me}
                                                media={m.voice.media}
                                            />
                                        ) : m.attachment ? (
                                            <ChatAttachmentBubble
                                                attachmentKey={m.attachment.key}
                                                mime={m.attachment.mime}
                                                filename={m.attachment.filename}
                                                sizeBytes={m.attachment.sizeBytes}
                                                mine={m.me}
                                                media={m.attachment.media}
                                            />
                                        ) : (
                                            <ChatEmojiRichText text={m.text} imgClassName={shared.chatEmojiInline} />
                                        )}
                                        <span className={styles.bubbleMeta}>
                                            <span className={styles.bubbleTime}>
                                                {formatChatTime(m.data)}
                                                {m.editedAt != null && m.editedAt > 0 ? (
                                                    <span className={styles.bubbleEdited} title="Сообщение изменено">
                                                        {" "}
                                                        · изм.
                                                    </span>
                                                ) : null}
                                            </span>
                                            {m.me ? (
                                                <MessageDeliveryStatus message={m} onRetry={onRetryMessage} />
                                            ) : null}
                                        </span>
                                    </div>
                                </div>
                                {m.reactions && m.reactions.length > 0 ? (
                                    <div className={styles.bubbleReactions} onContextMenu={(e) => e.stopPropagation()}>
                                        {m.reactions.map((g) => {
                                            const mine = !!(myName && g.users?.includes(myName))
                                            return (
                                                <button
                                                    key={g.emoji}
                                                    type="button"
                                                    className={`${styles.bubbleReactionChip} ${
                                                        mine ? styles.bubbleReactionChipMine : ""
                                                    }`}
                                                    onClick={() => onToggleReaction(m.id, g.emoji)}
                                                    aria-pressed={mine}
                                                    title={g.users?.join(", ") || g.emoji}
                                                >
                                                    <ChatEmojiImg
                                                        emoji={g.emoji}
                                                        className={styles.bubbleReactionEmoji}
                                                    />
                                                    <span className={styles.bubbleReactionCount}>
                                                        {g.users?.length || 0}
                                                    </span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                        {showNewDivider ? (
                            <div className={styles.newMessagesDivider} role="separator" aria-label="Новые сообщения">
                                <span className={styles.newMessagesDividerLine} />
                                <span className={styles.newMessagesDividerLabel}>Новые</span>
                                <span className={styles.newMessagesDividerLine} />
                            </div>
                        ) : null}
                        {dateDivider}
                    </Fragment>
                )
            })}
            {hasMore && (
                <button type="button" className={styles.loadOlder} disabled={olderLoading} onClick={onLoadOlder}>
                    {olderLoading ? "Загружаем…" : "Показать предыдущие сообщения"}
                </button>
            )}
            {showSkeletonOverlay ? (
                <div
                    className={`${styles.messagesSkelOverlay} ${loading ? "" : styles.messagesSkelOverlayOut}`}
                    aria-hidden={!loading}
                >
                    <div className={styles.messagesSkelOverlayInner}>
                        <ChatMessagesSkeleton compact />
                    </div>
                </div>
            ) : null}
        </div>
    )
}
