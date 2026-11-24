import { useCallback, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { FaShieldAlt } from "react-icons/fa"
import { fadeIn, transitionFast } from "../../../ui/styles/animations"
import styles from "../../../ui/chat/ChatHeader.module.css"

const e2eeTooltipMotion = {
    initial: { opacity: 0, y: -6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 }
}

const E2EE_TOOLTIP_DETAIL =
    "Текст шифруется на устройстве, на сервере хранится только шифр. В группах ключ комнаты передаётся в защищённых обёртках."

const TOOLTIP_MAX_W = 320
const VIEWPORT_PAD = 12

export function E2eeShieldButton() {
    const tipId = useId()
    const btnRef = useRef<HTMLButtonElement>(null)
    const reduceMotion = useReducedMotion()
    const [open, setOpen] = useState(false)
    const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

    const updateCoords = useCallback(() => {
        const el = btnRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const width = Math.min(TOOLTIP_MAX_W, window.innerWidth - VIEWPORT_PAD * 2)
        let left = rect.right - width
        left = Math.max(VIEWPORT_PAD, Math.min(left, window.innerWidth - width - VIEWPORT_PAD))
        setCoords({ top: rect.bottom + 10, left })
    }, [])

    const show = useCallback(() => {
        updateCoords()
        setOpen(true)
    }, [updateCoords])

    const hide = useCallback(() => {
        setOpen(false)
    }, [])

    useLayoutEffect(() => {
        if (!open) return
        updateCoords()
        const onLayout = () => updateCoords()
        window.addEventListener("resize", onLayout)
        window.addEventListener("scroll", onLayout, true)
        return () => {
            window.removeEventListener("resize", onLayout)
            window.removeEventListener("scroll", onLayout, true)
        }
    }, [open, updateCoords])

    const tooltip = createPortal(
        <AnimatePresence>
            {open && coords ? (
                <motion.span
                    key="e2ee-tooltip"
                    id={tipId}
                    className={styles.e2eeTooltipPortal}
                    role="tooltip"
                    variants={reduceMotion ? fadeIn : e2eeTooltipMotion}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    transition={reduceMotion ? { duration: 0.12 } : transitionFast}
                    style={{
                        position: "fixed",
                        top: coords.top,
                        left: coords.left,
                        maxWidth: TOOLTIP_MAX_W
                    }}
                >
                    <span className={styles.e2eeTooltipTitle}>Защищено сквозным шифрованием</span>
                    <span className={styles.e2eeTooltipDetail}>{E2EE_TOOLTIP_DETAIL}</span>
                </motion.span>
            ) : null}
        </AnimatePresence>,
        document.body
    )

    return (
        <>
            <button
                ref={btnRef}
                type="button"
                className={`${styles.iconButton} ${styles.iconButtonE2eeShield}`}
                aria-label="Сквозное шифрование сообщений"
                aria-describedby={open ? tipId : undefined}
                onMouseEnter={show}
                onMouseLeave={hide}
                onFocus={show}
                onBlur={hide}
            >
                <FaShieldAlt />
            </button>
            {tooltip}
        </>
    )
}
