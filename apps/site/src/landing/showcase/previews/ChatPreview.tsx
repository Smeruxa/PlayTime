import { IconSearch, IconSend } from "../../icons/PlayTimeIcons"
import styles from "../ShowcaseSection.module.css"

export function ChatPreview() {
    return (
        <div className={styles.preview}>
            <div className={styles.previewSearch}>
                <IconSearch size={12} />
                Поиск в диалогах
            </div>
            <p className={styles.previewLabel}>Комнаты</p>
            <div className={`${styles.previewRow} ${styles.previewRowActive}`}>
                <span className={styles.previewAvatar}>#</span>
                <span>
                    <strong>Команда</strong>
                    <span>Макс: Зайду с демо</span>
                </span>
            </div>
            <div className={styles.previewRow}>
                <span className={styles.previewAvatar}>#</span>
                <span>
                    <strong>Дизайн</strong>
                    <span>Аня: Макеты готовы</span>
                </span>
            </div>
            <p className={styles.previewLabel}>Диалоги</p>
            <div className={styles.previewRow}>
                <span className={`${styles.previewAvatar} ${styles.previewAvatarOnline}`} />
                <span>
                    <strong>Аня</strong>
                    <span>Созвон в 15:00?</span>
                </span>
            </div>
            <div className={styles.previewBubbleRow}>
                <div className={styles.previewBubble}>Созвон в 15:00?</div>
                <div className={`${styles.previewBubble} ${styles.previewBubbleSelf}`}>Экран готов</div>
            </div>
            <div className={styles.previewComposer}>
                <span>Написать сообщение…</span>
                <span className={styles.previewSend}>
                    <IconSend size={14} />
                </span>
            </div>
        </div>
    )
}
