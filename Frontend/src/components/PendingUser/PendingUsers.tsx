import styles from "./PendingUsers.module.css"
import { FriendItem } from "../../pages/Friends/Friends"
import { FaCheck, FaTimes, FaUserLock } from "react-icons/fa"

interface PendingUsersProps {
    users: FriendItem[];
    accept: (username: string) => void;
    decline: (username: string) => void;
    block: (username: string) => void;
}

export default function PendingUsers({ users, accept, decline, block }: PendingUsersProps) {
    return (
        <div className={styles.body}>
            {users.length > 0 ? (
                <ul className={styles.list}>
                    {users.map(r => (
                        <li key={r.id} className={styles.item}>
                            <div className={styles.left}>
                                <div className={styles.avatar}></div>
                                <div className={styles.info}>
                                    <span className={styles.username}>{r.friend_username}</span>
                                    <span className={styles.subtext}>Новая заявка в друзья</span>
                                </div>
                            </div>
                            <div className={styles.actions}>
                                <button onClick={() => accept(r.friend_username)} className={`${styles.button} ${styles.btnAccept}`}><FaCheck /></button>
                                <button onClick={() => decline(r.friend_username)} className={`${styles.button} ${styles.btnDecline}`}><FaTimes /></button>
                                <button onClick={() => block(r.friend_username)} className={`${styles.button} ${styles.btnBlock}`}><FaUserLock /></button>
                            </div>
                        </li>
                    ))}
                </ul>
            ) : (
                <h4>Пока у вас нет заявок :\</h4>
            )}
        </div>
    )
}