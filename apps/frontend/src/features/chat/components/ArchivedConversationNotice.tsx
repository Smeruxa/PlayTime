import { FaArchive } from "react-icons/fa"
import styles from "./ArchivedConversationNotice.module.css"

export function ArchivedConversationNotice() {
    return (
        <div className={styles.notice} role="status">
            <FaArchive className={styles.icon} aria-hidden />
            <div>
                <strong className={styles.title}>Гостевой аккаунт завершён</strong>
                <p className={styles.text}>История сообщений сохранена. Этот диалог доступен только для чтения.</p>
            </div>
        </div>
    )
}
