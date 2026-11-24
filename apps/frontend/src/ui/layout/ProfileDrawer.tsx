import { PeerSafetyActions } from "../../components/PeerSafetyActions/PeerSafetyActions"
import { useEffect } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { FaTimes } from "react-icons/fa"
import { usePublicProfile } from "../../features/chat/hooks/usePublicProfile"
import { PublicProfileCard } from "../../components/PublicProfileCard/PublicProfileCard"
import { drawerSlide, overlayFade, useReducedMotion } from "../styles/animations"
import styles from "./ProfileDrawer.module.css"

type ProfileDrawerProps = {
    open: boolean
    username: string
    peerUserId?: number
    onClose: () => void
}

export function ProfileDrawer({ open, username, peerUserId, onClose }: ProfileDrawerProps) {
    const reduced = useReducedMotion()
    const { profile, err, loading } = usePublicProfile(open ? username : null, peerUserId)

    useEffect(() => {
        if (!open) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose()
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [open, onClose])

    return (
        <AnimatePresence>
            {open ? (
                <>
                    <motion.button
                        type="button"
                        className={styles.backdrop}
                        aria-label="Закрыть профиль"
                        initial={overlayFade.initial}
                        animate={overlayFade.animate}
                        exit={overlayFade.exit}
                        transition={reduced ? { duration: 0.01 } : overlayFade.transition}
                        onClick={onClose}
                    />
                    <motion.aside
                        className={styles.drawer}
                        role="dialog"
                        aria-label={`Профиль ${username}`}
                        initial={drawerSlide.initial}
                        animate={drawerSlide.animate}
                        exit={drawerSlide.exit}
                        transition={reduced ? { duration: 0.01 } : drawerSlide.transition}
                    >
                        <div className={styles.head}>
                            <span className={styles.title}>Профиль</span>
                            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Закрыть">
                                <FaTimes size={14} />
                            </button>
                        </div>
                        <div className={styles.scroll}>
                            {loading ? <div className={styles.loading}>Загрузка…</div> : null}
                            {!loading && err ? <div className={styles.err}>{err}</div> : null}
                            {!loading && profile ? <PublicProfileCard profile={profile} /> : null}
                            <PeerSafetyActions username={username} peerUserId={peerUserId} />
                        </div>
                    </motion.aside>
                </>
            ) : null}
        </AnimatePresence>
    )
}
