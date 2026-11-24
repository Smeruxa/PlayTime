import { useNavigate } from "react-router-dom"
import { FaTimes } from "react-icons/fa"
import { AvatarWithEffect } from "../Profile/AvatarWithEffect"
import styles from "./Friends.module.css"
import type { FriendItem } from "./types"

type FriendsAcceptedListProps = {
    friends: FriendItem[]
    onlineUserIds: Set<number>
    avatarFor: (userId: number) => string | null
    avatarEffectFor: (userId: number) => string
    onRemoveClick: (friend: FriendItem) => void
}

export function FriendsAcceptedList({
    friends,
    onlineUserIds,
    avatarFor,
    avatarEffectFor,
    onRemoveClick
}: FriendsAcceptedListProps) {
    const navigate = useNavigate()
    if (friends.length === 0) {
        return <p className={styles.emptyMuted}>Пока нет принятых друзей.</p>
    }
    return (
        <ul className={styles.list}>
            {friends.map((f) => {
                const online = !f.friend_archived && onlineUserIds.has(f.other_user_id!)
                const av = avatarFor(f.other_user_id!)
                const fx = avatarEffectFor(f.other_user_id!)
                return (
                    <li key={f.id} className={styles.row}>
                        <div className={styles.rowLeft}>
                            <div className={styles.avatarSlot}>
                                <AvatarWithEffect effect={fx} className={styles.avatarFxFill}>
                                    {av ? (
                                        <img src={av} alt="" className={styles.avatarImg} />
                                    ) : (
                                        <span className={styles.avatarInitial} aria-hidden>
                                            {(Array.from(f.friend_username.trim())[0] || "?").toUpperCase()}
                                        </span>
                                    )}
                                </AvatarWithEffect>
                            </div>
                            <div className={styles.rowText}>
                                <span className={styles.rowName}>{f.friend_username}</span>
                                <span className={styles.rowMeta}>
                                    <span className={online ? styles.dotOnline : styles.dotOffline} aria-hidden />
                                    <span className={styles.rowMetaLabel}>
                                        {f.friend_archived
                                            ? "Гостевой аккаунт завершён"
                                            : online
                                              ? "в сети"
                                              : "не в сети"}
                                    </span>
                                </span>
                            </div>
                        </div>
                        <div className={styles.rowActions}>
                            <button
                                type="button"
                                className={styles.btnGhost}
                                onClick={() =>
                                    navigate("/content", {
                                        state: { name: f.friend_username, peerUserId: f.other_user_id }
                                    })
                                }
                            >
                                Написать
                            </button>
                            <button
                                type="button"
                                className={styles.iconDanger}
                                onClick={() => onRemoveClick(f)}
                                title="Удалить из друзей"
                                aria-label="Удалить из друзей"
                            >
                                <FaTimes />
                            </button>
                        </div>
                    </li>
                )
            })}
        </ul>
    )
}
