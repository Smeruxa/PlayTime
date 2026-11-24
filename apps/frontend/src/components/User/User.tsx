import styles from "./User.module.css"
import { AvatarWithEffect } from "../../pages/Profile/AvatarWithEffect"

type LastPreview = { from: string; content: string }

type UserProps = {
    archived?: boolean
    name: string
    id: number
    is_room: boolean
    online?: boolean
    lastPreview?: LastPreview
    avatarUrl?: string | null
    avatarEffect?: string
    unreadCount?: number
    onClick?: () => void
}

export default function User(props: UserProps) {
    const {
        name,
        archived,
        is_room,
        online,
        lastPreview,
        avatarUrl,
        avatarEffect = "none",
        unreadCount = 0,
        onClick
    } = props
    const rawName = name.trim()
    const initial = (rawName.charAt(0) || "?").toUpperCase()
    return (
        <div className={styles.body} onClick={onClick}>
            <div className={styles.content}>
                <div className={is_room ? styles.roomAvatar : styles.avatar}>
                    {is_room ? (
                        <span className={styles.avatarInitial}>{initial}</span>
                    ) : (
                        <AvatarWithEffect effect={avatarEffect} className={styles.avatarFxWrap}>
                            {avatarUrl ? (
                                <img src={avatarUrl} alt="" className={styles.avatarImg} />
                            ) : (
                                <span className={styles.avatarInitial}>{initial}</span>
                            )}
                        </AvatarWithEffect>
                    )}
                </div>
                <div className={styles.nameBlock}>
                    <span className={styles.nameRow}>
                        <span className={styles.name}>{name}</span>
                        {unreadCount > 0 ? (
                            <span className={styles.roomUnreadBadge} title="Непрочитанные">
                                {unreadCount > 99 ? "99+" : String(unreadCount)}
                            </span>
                        ) : null}
                    </span>
                    {archived ? (
                        <span className={styles.lastPreview}>Гость вышел · история сохранена</span>
                    ) : (
                        lastPreview && (
                            <span className={styles.lastPreview}>
                                <span className={styles.previewFrom}>{lastPreview.from}: </span>
                                <span className={styles.previewText}>{lastPreview.content}</span>
                            </span>
                        )
                    )}
                </div>
                {!is_room && <span className={online ? styles.statusOnline : styles.statusOffline} aria-hidden />}
            </div>
        </div>
    )
}
