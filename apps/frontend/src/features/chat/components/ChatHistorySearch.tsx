import { forwardRef, useId } from "react"
import styles from "../../../ui/chat/ChatShell.module.css"

type Props = {
    value: string
    onChange: (v: string) => void
    matchIndex: number
    matchCount: number
    onPrev: () => void
    onNext: () => void
}

export const ChatHistorySearch = forwardRef<HTMLInputElement, Props>(function ChatHistorySearch(
    { value, onChange, matchIndex, matchCount, onPrev, onNext },
    ref
) {
    const id = useId()
    return (
        <div className={styles.chatHistorySearch} role="search">
            <label htmlFor={id} className={styles.chatHistorySearchLabel}>
                Поиск
            </label>
            <input
                ref={ref}
                id={id}
                type="search"
                className={styles.chatHistorySearchInput}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="В этом чате…"
                autoComplete="off"
            />
            {matchCount > 0 ? (
                <div className={styles.chatHistorySearchNav} aria-live="polite">
                    <span className={styles.chatHistorySearchCount}>
                        {matchIndex + 1}/{matchCount}
                    </span>
                    <button type="button" className={styles.chatHistorySearchBtn} onClick={onPrev} title="Предыдущее">
                        ↑
                    </button>
                    <button type="button" className={styles.chatHistorySearchBtn} onClick={onNext} title="Следующее">
                        ↓
                    </button>
                </div>
            ) : value.trim() ? (
                <span className={styles.chatHistorySearchEmpty}>Нет</span>
            ) : null}
        </div>
    )
})
