import { useEffect, useLayoutEffect, useRef, useState, lazy, Suspense } from "react"
import type { DisplayMessage } from "../types"
import { ChatEmojiImg } from "./ChatEmojiImg"
const ChatEmojiPicker = lazy(() => import("./ChatEmojiPicker").then((module) => ({ default: module.ChatEmojiPicker })))
import styles from "./MessageContextMenu.module.css"

type Props = {
    readOnly?: boolean
    message: DisplayMessage
    is_room: boolean
    clientX: number
    clientY: number
    onReply: () => void
    onEdit: () => void
    onReact: (emoji: string) => void
    onDelete: () => void
    onWhoRead?: () => void
    pinnedMessageId?: number | null
    onSetPin?: (messageId: number | null) => void
    onClose: () => void
}

const MENU_W = 200
const MENU_H_EST = 300
const QUICK_REACTIONS = ["👍", "❤️", "😂", "🙏", "👀", "✅"] as const

export function MessageContextMenu({
    readOnly = false,
    message,
    is_room,
    clientX,
    clientY,
    onReply,
    onEdit,
    onReact,
    onDelete,
    onWhoRead,
    pinnedMessageId = null,
    onSetPin,
    onClose
}: Props) {
    const ref = useRef<HTMLDivElement>(null)
    const reactionMoreRef = useRef<HTMLButtonElement>(null)
    const [reactionPickerOpen, setReactionPickerOpen] = useState(false)
    const [emojiMountKey, setEmojiMountKey] = useState(0)
    const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null)
    const [[left, top], setPos] = useState(() => clampMenu(clientX, clientY, MENU_W, MENU_H_EST))

    useEffect(() => {
        setReactionPickerOpen(false)
    }, [clientX, clientY, message.id])

    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        const w = el.offsetWidth
        const h = el.offsetHeight
        setPos(clampMenu(clientX, clientY, w, h))
    }, [clientX, clientY, message.id, is_room, pinnedMessageId, reactionPickerOpen])

    useLayoutEffect(() => {
        if (!reactionPickerOpen) {
            setPickerAnchor(null)
            return
        }
        const btn = reactionMoreRef.current
        if (btn) setPickerAnchor(btn.getBoundingClientRect())
    }, [reactionPickerOpen, emojiMountKey])

    return (
        <div
            ref={ref}
            className={styles.menu}
            style={{ left, top }}
            role="menu"
            onMouseDown={(e) => e.stopPropagation()}
        >
            {!readOnly ? (
                <>
                    <button type="button" className={styles.item} role="menuitem" onClick={onReply}>
                        Ответить
                    </button>
                    <div className={styles.reactionStrip} role="group" aria-label="Реакция">
                        <div className={styles.reactionCarousel}>
                            {QUICK_REACTIONS.map((em) => (
                                <button
                                    key={em}
                                    type="button"
                                    className={styles.reactionPill}
                                    onClick={() => onReact(em)}
                                    title={em}
                                >
                                    <ChatEmojiImg emoji={em} className={styles.reactionPillImg} title={em} />
                                </button>
                            ))}
                        </div>
                        <div className={styles.reactionMoreWrap}>
                            <button
                                ref={reactionMoreRef}
                                type="button"
                                className={styles.reactionMoreBtn}
                                data-chat-reaction-emoji-toggle
                                aria-expanded={reactionPickerOpen}
                                aria-haspopup="listbox"
                                aria-label="Другие реакции"
                                title="Другие реакции"
                                onClick={() => {
                                    setEmojiMountKey((k) => k + 1)
                                    setReactionPickerOpen((o) => !o)
                                }}
                            >
                                ⋯
                            </button>
                            <Suspense fallback={<span>Загрузка…</span>}>
                                <ChatEmojiPicker
                                    key={emojiMountKey}
                                    open={reactionPickerOpen}
                                    anchorRect={pickerAnchor}
                                    onClose={() => setReactionPickerOpen(false)}
                                    onPick={(em) => {
                                        onReact(em)
                                        setReactionPickerOpen(false)
                                        onClose()
                                    }}
                                />
                            </Suspense>
                        </div>
                    </div>
                </>
            ) : null}
            {!readOnly && message.me && !message.voice && !message.attachment ? (
                <button type="button" className={styles.item} role="menuitem" onClick={onEdit}>
                    Изменить
                </button>
            ) : null}
            {message.me ? (
                <button type="button" className={styles.item} role="menuitem" onClick={onDelete}>
                    Удалить у всех
                </button>
            ) : null}
            {!readOnly && onSetPin && !message.isThreadOp ? (
                <button
                    type="button"
                    className={styles.item}
                    role="menuitem"
                    onClick={() => {
                        onSetPin(pinnedMessageId === message.id ? null : message.id)
                        onClose()
                    }}
                >
                    {pinnedMessageId === message.id ? "Открепить" : "Закрепить"}
                </button>
            ) : null}
            {is_room ? (
                <button type="button" className={styles.item} role="menuitem" onClick={() => onWhoRead?.()}>
                    Кто прочитал
                </button>
            ) : null}
            <button type="button" className={styles.itemMuted} onClick={onClose}>
                Закрыть
            </button>
        </div>
    )
}

function clampMenu(x: number, y: number, w: number, h: number): [number, number] {
    const pad = 6
    let left = x
    let top = y
    if (left + w + pad > window.innerWidth) left = window.innerWidth - w - pad
    if (top + h + pad > window.innerHeight) top = window.innerHeight - h - pad
    if (left < pad) left = pad
    if (top < pad) top = pad
    return [left, top]
}
