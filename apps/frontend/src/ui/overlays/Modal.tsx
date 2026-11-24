import { useEffect, useId, useRef, type ReactNode } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { FaTimes } from "react-icons/fa"
import { overlayFade, scaleIn, useReducedMotion } from "../styles/animations"
import styles from "./Modal.module.css"

const dialogStack: HTMLElement[] = []
const focusSelector =
    'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

type ModalProps = {
    open?: boolean
    title: string
    onClose: () => void
    children: ReactNode
    footer?: ReactNode
    panelClassName?: string
}

export function Modal({ open = true, title, onClose, children, footer, panelClassName }: ModalProps) {
    const reduced = useReducedMotion()
    const titleId = useId()
    const panelRef = useRef<HTMLDivElement>(null)
    const closeRef = useRef(onClose)
    closeRef.current = onClose

    useEffect(() => {
        const panel = panelRef.current
        if (!open || !panel) return
        const previous = document.activeElement as HTMLElement | null
        dialogStack.push(panel)
        const focusable = () =>
            Array.from(panel.querySelectorAll<HTMLElement>(focusSelector)).filter(
                (el) => !el.closest('[hidden], [aria-hidden="true"]')
            )
        ;(panel.querySelector<HTMLElement>("[autofocus]") || focusable()[0] || panel).focus()
        const onKey = (e: KeyboardEvent) => {
            if (dialogStack.at(-1) !== panel) return
            if (e.key === "Escape") {
                e.preventDefault()
                e.stopPropagation()
                closeRef.current()
            } else if (e.key === "Tab") {
                const items = focusable(),
                    first = items[0],
                    last = items.at(-1)
                if (
                    !first ||
                    (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement)))
                ) {
                    e.preventDefault()
                    ;(last || panel).focus()
                } else if (
                    !e.shiftKey &&
                    (document.activeElement === last || !panel.contains(document.activeElement))
                ) {
                    e.preventDefault()
                    first.focus()
                }
            }
        }
        document.addEventListener("keydown", onKey, true)
        return () => {
            document.removeEventListener("keydown", onKey, true)
            dialogStack.splice(dialogStack.indexOf(panel), 1)
            if (previous?.isConnected) previous.focus()
        }
    }, [open])

    return (
        <AnimatePresence>
            {open ? (
                <motion.div
                    className={styles.overlay}
                    role="presentation"
                    initial={overlayFade.initial}
                    animate={overlayFade.animate}
                    exit={overlayFade.exit}
                    transition={reduced ? { duration: 0.01 } : overlayFade.transition}
                    onMouseDown={(e) => {
                        if (e.target === e.currentTarget) onClose()
                    }}
                >
                    <motion.div
                        ref={panelRef}
                        tabIndex={-1}
                        className={[styles.panel, panelClassName].filter(Boolean).join(" ")}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={titleId}
                        initial={scaleIn.initial}
                        animate={scaleIn.animate}
                        exit={scaleIn.exit}
                        transition={reduced ? { duration: 0.01 } : scaleIn.transition}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <div className={styles.head}>
                            <h2 id={titleId} className={styles.title}>
                                {title}
                            </h2>
                            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Закрыть">
                                <FaTimes size={14} />
                            </button>
                        </div>
                        <div className={styles.body}>{children}</div>
                        {footer ? <div className={styles.footer}>{footer}</div> : null}
                    </motion.div>
                </motion.div>
            ) : null}
        </AnimatePresence>
    )
}
