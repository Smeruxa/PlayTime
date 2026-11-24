import { IconContext } from "react-icons"
import { FaSignOutAlt, FaCog } from "react-icons/fa"
import { AvatarWithEffect } from "../../pages/Profile/AvatarWithEffect"
import styles from "./Profile.module.css"

interface ProfileProps {
    username?: string | null
    avatarUrl?: string | null
    avatarEffect?: string
    onOut: () => void
    onOpenMyProfile?: () => void
    onOpenSettings?: () => void
}

export default function Profile({
    username,
    avatarUrl,
    avatarEffect = "none",
    onOut,
    onOpenMyProfile,
    onOpenSettings
}: ProfileProps) {
    return (
        <div className={styles.body}>
            <div className={styles.left}>
                <button
                    type="button"
                    className={`${styles.identityHit} ${!username ? styles.identityHitDisabled : ""}`}
                    disabled={!username}
                    title={username ? "Мой профиль" : undefined}
                    aria-label={username ? "Открыть мой профиль" : undefined}
                    onClick={() => {
                        if (username) onOpenMyProfile?.()
                    }}
                >
                    <div className={styles.avatarWrap}>
                        <div className={styles.circle}>
                            <AvatarWithEffect effect={avatarEffect} className={styles.dockAvatarFx}>
                                {avatarUrl ? <img src={avatarUrl} alt="" className={styles.circleImg} /> : null}
                            </AvatarWithEffect>
                            <div className={styles.onlineCircle} aria-hidden />
                        </div>
                    </div>
                    <span className={styles.nickname}>{username || "Unknown"}</span>
                </button>
            </div>
            <div className={styles.right}>
                <IconContext.Provider value={{ size: "1.15rem", className: styles.iconGlyph }}>
                    <div className={styles.icons}>
                        <button
                            type="button"
                            className={styles.iconBtn}
                            title="Настройки"
                            aria-label="Настройки"
                            onClick={() => onOpenSettings?.()}
                        >
                            <FaCog />
                        </button>
                        <button
                            type="button"
                            className={styles.iconBtn}
                            title="Выйти из аккаунта"
                            aria-label="Выйти из аккаунта"
                            onClick={onOut}
                        >
                            <FaSignOutAlt />
                        </button>
                    </div>
                </IconContext.Provider>
            </div>
        </div>
    )
}
