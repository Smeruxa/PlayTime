import { useCallback, useEffect, useRef, useState } from "react"
import styles from "./HoldDeleteButton.module.css"

const HOLD_MS = 3000

type Props = {
    disabled?: boolean
    onHoldComplete: () => void
    idleLabel?: string
    holdingLabel?: string
    ariaLabel: string
    trackClassName?: string
}

export function HoldDeleteButton({
    disabled = false,
    onHoldComplete,
    idleLabel = "Удалить",
    holdingLabel = "Удерживайте…",
    ariaLabel,
    trackClassName
}: Props) {
    const [progress, setProgress] = useState(0)
    const holdingRef = useRef(false)
    const startRef = useRef(0)
    const rafRef = useRef(0)
    const firedRef = useRef(false)

    const stopRaf = useCallback(() => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
    }, [])

    const reset = useCallback(() => {
        holdingRef.current = false
        stopRaf()
        setProgress(0)
        firedRef.current = false
    }, [stopRaf])

    useEffect(
        () => () => {
            holdingRef.current = false
            stopRaf()
        },
        [stopRaf]
    )
    useEffect(() => {
        if (disabled) reset()
    }, [disabled, reset])

    const startHold = () => {
        if (disabled || holdingRef.current) return
        holdingRef.current = true
        firedRef.current = false
        startRef.current = Date.now()

        const loop = () => {
            if (!holdingRef.current || disabled) return
            const elapsed = Date.now() - startRef.current
            const p = Math.min(1, elapsed / HOLD_MS)
            setProgress(p)
            if (p >= 1 && !firedRef.current) {
                firedRef.current = true
                onHoldComplete()
                reset()
                return
            }
            rafRef.current = requestAnimationFrame(loop)
        }
        rafRef.current = requestAnimationFrame(loop)
    }

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        if (disabled) return
        e.currentTarget.focus()
        e.currentTarget.setPointerCapture(e.pointerId)
        startHold()
    }

    const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault()
        e.stopPropagation()
        try {
            e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {
        }
        const wasHolding = holdingRef.current
        holdingRef.current = false
        stopRaf()
        if (!firedRef.current && wasHolding) setProgress(0)
    }

    const label = progress > 0.02 ? holdingLabel : idleLabel
    const trackCls = [styles.track, disabled ? styles.trackDisabled : "", trackClassName || ""]
        .filter(Boolean)
        .join(" ")

    return (
        <div
            className={trackCls}
            onClick={(ev) => ev.stopPropagation()}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onLostPointerCapture={reset}
            onBlur={reset}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-label={ariaLabel}
            aria-disabled={disabled}
            onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault()
                    ev.stopPropagation()
                    if (!ev.repeat) startHold()
                }
            }}
            onKeyUp={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault()
                    reset()
                }
            }}
        >
            <div className={styles.fillWrap} aria-hidden>
                <div className={styles.fill} style={{ transform: `scaleX(${progress})` }} />
            </div>
            <span className={styles.label}>{label}</span>
        </div>
    )
}
