import styles from "./PendingUsers.module.css"
import type { FriendItem } from "../../pages/Friends/types"
import { FaCheck, FaTimes, FaUserLock, FaSadTear } from "react-icons/fa"
import { AvatarWithEffect } from "../../pages/Profile/AvatarWithEffect"
import type { FriendsAvatarsMap } from "../../types/friendAvatar"

interface PendingUsersProps {
    users: FriendItem[]
    accept: (friend: FriendItem) => void
    decline: (friend: FriendItem) => void
    block: (friend: FriendItem) => void
    avatarByUsername?: FriendsAvatarsMap
}

export default function PendingUsers({ users, accept, decline, block, avatarByUsername }: PendingUsersProps) {
    const meta = (userId: number | undefined) => (userId == null ? undefined : avatarByUsername?.[userId])

    if (users.length === 0) {
        return (
            <div className={styles.empty}>
                <FaSadTear className={styles.emptyIcon} aria-hidden />
                <span>Входящих заявок нет.</span>
            </div>
        )
    }

    return (
        <ul className={styles.list}>
            {users.map((r) => {
                const m = meta(r.other_user_id)
                const url = m?.avatar ?? null
                const fx = m?.profileAvatarEffect ?? "none"
                return (
                    <li key={r.id} className={styles.row}>
                        <div className={styles.rowLeft}>
                            <div className={styles.avatarSlot}>
                                <AvatarWithEffect effect={fx} className={styles.avatarFxFill}>
                                    {url ? (
                                        <img src={url} alt="" className={styles.avatarImg} />
                                    ) : (
                                        <span className={styles.avatarInitial} aria-hidden>
                                            {(Array.from(r.friend_username.trim())[0] || "?").toUpperCase()}
                                        </span>
                                    )}
                                </AvatarWithEffect>
                            </div>
                            <div className={styles.rowText}>
                                <span className={styles.rowName}>{r.friend_username}</span>
                                <span className={styles.rowMeta}>
                                    {r.friend_archived ? "Гостевой аккаунт завершён" : "заявка в друзья"}
                                </span>
                            </div>
                        </div>
                        <div className={styles.actions}>
                            <button
                                type="button"
                                className={styles.iconBtn}
                                onClick={() => accept(r)}
                                disabled={r.friend_archived}
                                title="Принять"
                                aria-label="Принять заявку"
                            >
                                <FaCheck />
                            </button>
                            <button
                                type="button"
                                className={`${styles.iconBtn} ${styles.iconMuted}`}
                                onClick={() => decline(r)}
                                title="Отклонить"
                                aria-label="Отклонить заявку"
                            >
                                <FaTimes />
                            </button>
                            <button
                                type="button"
                                className={`${styles.iconBtn} ${styles.iconWarn}`}
                                onClick={() => block(r)}
                                title="Заблокировать"
                                aria-label="Заблокировать"
                            >
                                <FaUserLock />
                            </button>
                        </div>
                    </li>
                )
            })}
        </ul>
    )
}
