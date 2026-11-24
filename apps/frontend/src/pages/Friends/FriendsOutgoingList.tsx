import type { FriendIdentity } from "./types"
import { AvatarWithEffect } from "../Profile/AvatarWithEffect"
import styles from "./Friends.module.css"

type FriendsOutgoingListProps = {
    outgoingRequests: FriendIdentity[]
    avatarFor: (userId: number) => string | null
    avatarEffectFor: (userId: number) => string
    onDeclineOutgoing: (friend: FriendIdentity) => void
}

export function FriendsOutgoingList({
    outgoingRequests,
    avatarFor,
    avatarEffectFor,
    onDeclineOutgoing
}: FriendsOutgoingListProps) {
    if (outgoingRequests.length === 0) {
        return <p className={styles.emptyMuted}>Исходящих запросов нет.</p>
    }
    return (
        <ul className={styles.list}>
            {outgoingRequests.map((n) => {
                const av = avatarFor(n.userId)
                const fx = avatarEffectFor(n.userId)
                return (
                    <li key={n.userId} className={styles.row}>
                        <div className={styles.rowLeft}>
                            <div className={styles.avatarSlot}>
                                <AvatarWithEffect effect={fx} className={styles.avatarFxFill}>
                                    {av ? (
                                        <img src={av} alt="" className={styles.avatarImg} />
                                    ) : (
                                        <span className={styles.avatarInitial} aria-hidden>
                                            {(Array.from(n.username.trim())[0] || "?").toUpperCase()}
                                        </span>
                                    )}
                                </AvatarWithEffect>
                            </div>
                            <div className={styles.rowText}>
                                <span className={styles.rowName}>{n.username}</span>
                                <span className={styles.rowMetaMuted}>
                                    {n.archived ? "Гостевой аккаунт завершён" : "запрос отправлен"}
                                </span>
                            </div>
                        </div>
                        <div className={styles.rowActions}>
                            <button type="button" className={styles.btnGhost} onClick={() => onDeclineOutgoing(n)}>
                                Отменить
                            </button>
                        </div>
                    </li>
                )
            })}
        </ul>
    )
}
