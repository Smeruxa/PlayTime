import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { EMOJI_PAGE_SIZE, getEmojiPage, getEmojiPageCount } from "../emoji/emojiDataset"
import { getEmojiUsageVersion, getFrequentChatEmojis, subscribeEmojiUsage } from "../emoji/emojiUsageStorage"
import { clampFloatingPanel } from "../utils/clampFloatingPanel"
import { ChatEmojiImg } from "./ChatEmojiImg"
import styles from "../../../ui/chat/ComposerShell.module.css"

const FREQUENT_MAX = 30
const PICKER_W = 292
const PICKER_H_EST = 260

type ChatEmojiPickerProps = {
    open: boolean
    onClose: () => void
    onPick: (emoji: string) => void
    anchorRect?: DOMRect | null
}

export function ChatEmojiPicker({ open, onClose, onPick, anchorRect }: ChatEmojiPickerProps) {
    const rootRef = useRef<HTMLDivElement>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const sentinelRef = useRef<HTMLDivElement>(null)
    const [pagesVisible, setPagesVisible] = useState(1)
    const [floatPos, setFloatPos] = useState<{ top: number; left: number } | null>(null)
    const totalPages = getEmojiPageCount(EMOJI_PAGE_SIZE)
    const usageVersion = useSyncExternalStore(subscribeEmojiUsage, getEmojiUsageVersion, () => 0)
    void usageVersion
    const frequent = getFrequentChatEmojis(FREQUENT_MAX)
    const isFloating = anchorRect != null

    useEffect(() => {
        if (!open) return
        setPagesVisible(1)
    }, [open])

    useLayoutEffect(() => {
        if (!open || !isFloating || !anchorRect) {
            setFloatPos(null)
            return
        }
        const el = rootRef.current
        const w = el?.offsetWidth ?? PICKER_W
        const h = el?.offsetHeight ?? PICKER_H_EST
        setFloatPos(clampFloatingPanel(anchorRect, w, h, true))
    }, [open, isFloating, anchorRect, pagesVisible])

    useEffect(() => {
        if (!open) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose()
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [open, onClose])

    useEffect(() => {
        if (!open) return
        const onDoc = (e: MouseEvent) => {
            const el = e.target as Node | null
            if (!el) return
            if (rootRef.current?.contains(el)) return
            if ((e.target as Element).closest?.("[data-chat-emoji-toggle]")) return
            if ((e.target as Element).closest?.("[data-chat-reaction-emoji-toggle]")) return
            onClose()
        }
        document.addEventListener("mousedown", onDoc, true)
        return () => document.removeEventListener("mousedown", onDoc, true)
    }, [open, onClose])

    const tryLoadMore = useCallback(() => {
        setPagesVisible((p) => Math.min(totalPages, p + 1))
    }, [totalPages])

    useEffect(() => {
        if (!open || pagesVisible >= totalPages) return
        const root = scrollRef.current
        const sentinel = sentinelRef.current
        if (!root || !sentinel) return
        const io = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) tryLoadMore()
                }
            },
            { root, rootMargin: "72px", threshold: 0 }
        )
        io.observe(sentinel)
        return () => io.disconnect()
    }, [open, pagesVisible, totalPages, tryLoadMore])

    if (!open) return null

    const items: string[] = []
    for (let i = 0; i < pagesVisible; i++) {
        items.push(...getEmojiPage(i, EMOJI_PAGE_SIZE))
    }

    const pickerClass = isFloating ? styles.emojiPickerFloating : styles.emojiPicker
    const pickerStyle = isFloating && floatPos ? { top: floatPos.top, left: floatPos.left } : undefined

    const picker = (
        <div
            ref={rootRef}
            className={pickerClass}
            style={pickerStyle}
            role="listbox"
            aria-label="Смайлики"
        >
            <div ref={scrollRef} className={styles.emojiPickerScroll}>
                {frequent.length > 0 ? (
                    <>
                        <div className={styles.emojiPickerSectionLabel}>Чаще всего используемые</div>
                        <div className={styles.emojiPickerGrid}>
                            {frequent.map((em) => (
                                <button
                                    key={`freq-${em}`}
                                    type="button"
                                    className={styles.emojiPickerCell}
                                    title={em}
                                    onClick={() => onPick(em)}
                                >
                                    <ChatEmojiImg emoji={em} className={styles.emojiPickerImg} title={em} />
                                </button>
                            ))}
                        </div>
                        <div className={styles.emojiPickerSeparator} role="separator" aria-hidden />
                        <div className={styles.emojiPickerSectionLabel}>Все смайлики</div>
                    </>
                ) : null}
                <div className={styles.emojiPickerGrid}>
                    {items.map((em, idx) => (
                        <button
                            key={`${idx}-${em}`}
                            type="button"
                            className={styles.emojiPickerCell}
                            title={em}
                            onClick={() => onPick(em)}
                        >
                            <ChatEmojiImg emoji={em} className={styles.emojiPickerImg} title={em} />
                        </button>
                    ))}
                </div>
                <div ref={sentinelRef} className={styles.emojiPickerSentinel} aria-hidden />
            </div>
        </div>
    )

    if (isFloating) return createPortal(picker, document.body)
    return picker
}
