import type { KeyboardEvent, ReactNode } from "react"
import { FiCheck, FiPlus } from "react-icons/fi"
import styles from "./ProfileEffectsCarousel.module.css"

export type EffectOption = { id: string; title: string; hint: string }
type ProfileEffectPickerProps = {
    sectionTitle: string
    layout: "avatar" | "banner" | "sticker"
    options: EffectOption[]
    value: string
    onChange: (id: string) => void
    disabled?: boolean
    locked?: boolean
    allowedIds?: readonly string[]
    onMore?: () => void
    moreLabel?: string
    upgradePreviewId?: string
    renderMini: (id: string) => ReactNode
}

export function ProfileEffectPicker({
    sectionTitle,
    layout,
    options,
    value,
    onChange,
    disabled,
    locked,
    allowedIds,
    onMore,
    moreLabel,
    upgradePreviewId,
    renderMini
}: ProfileEffectPickerProps) {
    const visible = options.filter(
        (option) => option.id === "none" || (!locked && (!allowedIds || allowedIds.includes(option.id)))
    )
    const selected = visible.some((option) => option.id === value) ? value : visible[0]?.id
    const hasMore = visible.length < options.length && !!onMore
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (disabled) return
        const buttons = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')
        )
        const index = buttons.indexOf(event.target as HTMLButtonElement)
        if (index < 0) return
        const next =
            event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : event.key === "ArrowRight" || event.key === "ArrowDown"
                    ? (index + 1) % buttons.length
                    : event.key === "ArrowLeft" || event.key === "ArrowUp"
                      ? (index - 1 + buttons.length) % buttons.length
                      : null
        if (next == null) return
        event.preventDefault()
        buttons[next].focus({ preventScroll: true })
        buttons[next].scrollIntoView({ block: "nearest", inline: "nearest" })
        buttons[next].click()
    }
    return (
        <div
            className={`${styles.picker} ${styles[layout]}${hasMore ? ` ${styles.limited}` : ""}`}
            role="radiogroup"
            aria-label={sectionTitle}
            onKeyDown={onKeyDown}
        >
            {visible.map((option) => {
                const isSelected = selected === option.id
                return (
                    <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-label={option.title}
                        title={option.hint}
                        aria-checked={isSelected}
                        tabIndex={isSelected ? 0 : -1}
                        disabled={disabled}
                        className={`${styles.option}${isSelected ? ` ${styles.selected}` : ""}`}
                        onClick={() => {
                            if (!isSelected) onChange(option.id)
                        }}
                    >
                        <span className={styles.preview}>{renderMini(option.id)}</span>
                        <span className={styles.label}>{option.title}</span>
                        {isSelected ? <FiCheck className={styles.marker} aria-hidden /> : null}
                    </button>
                )
            })}
            {hasMore ? (
                <button
                    type="button"
                    className={`${styles.option} ${styles.more}`}
                    disabled={disabled}
                    aria-label={moreLabel || `Ещё: ${sectionTitle}`}
                    aria-haspopup="dialog"
                    onClick={onMore}
                >
                    <span className={styles.preview} aria-hidden>
                        {renderMini(upgradePreviewId || "none")}
                    </span>
                    <span className={styles.label}>Ещё…</span>
                    <FiPlus className={styles.marker} aria-hidden />
                </button>
            ) : null}
        </div>
    )
}
