import { PeerSafetyActions } from "../PeerSafetyActions/PeerSafetyActions"
import { motion, useReducedMotion } from "framer-motion"
import { usePublicProfile } from "../../features/chat/hooks/usePublicProfile"
import { PublicProfileCard } from "../PublicProfileCard/PublicProfileCard"
import styles from "./UserProfileModal.module.css"

type Props = {
    username: string
    onClose: () => void
}

export default function UserProfileModal({ username, onClose }: Props) {
    const { profile, err, loading } = usePublicProfile(username)
    const reduced = useReducedMotion()

    return (
        <motion.div
            className={styles.overlay}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduced ? 0 : 0.18 }}
        >
            <motion.div
                className={styles.box}
                role="dialog"
                aria-modal="true"
                aria-label={`Профиль ${username}`}
                onClick={(e) => e.stopPropagation()}
                initial={reduced ? false : { y: 8, scale: 0.98 }}
                animate={{ y: 0, scale: 1 }}
                transition={{ duration: reduced ? 0 : 0.18 }}
            >
                <div className={styles.head}>
                    <span>Профиль</span>
                    <button type="button" className={styles.closeBtn} onClick={onClose}>
                        Закрыть
                    </button>
                </div>
                <div className={styles.body}>
                    {loading && <div className={styles.loading}>Загрузка…</div>}
                    {!loading && err && <div className={styles.err}>{err}</div>}
                    {!loading && profile ? <PublicProfileCard profile={profile} /> : null}
                    <PeerSafetyActions username={username} />
                </div>
            </motion.div>
        </motion.div>
    )
}
