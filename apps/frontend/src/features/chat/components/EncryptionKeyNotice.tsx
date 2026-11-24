import { FiArrowRight, FiKey, FiX } from "react-icons/fi"
import { Button } from "../../../ui/primitives/Button"
import { IconButton } from "../../../ui/primitives/IconButton"
import styles from "./EncryptionKeyNotice.module.css"

type EncryptionKeyNoticeProps = {
    message: string
    onOpenKeys: () => void
    onDismiss: () => void
}

export function EncryptionKeyNotice({ message, onOpenKeys, onDismiss }: EncryptionKeyNoticeProps) {
    return (
        <aside className={styles.notice} role="alert">
            <span className={styles.icon} aria-hidden="true">
                <FiKey />
            </span>
            <div className={styles.copy}>
                <strong className={styles.title}>Ключи переписки на этом устройстве</strong>
                <p className={styles.message}>{message}</p>
            </div>
            <Button variant="secondary" className={styles.action} onClick={onOpenKeys}>
                Открыть управление ключами
                <FiArrowRight aria-hidden="true" />
            </Button>
            <IconButton
                size="sm"
                className={styles.close}
                aria-label="Закрыть уведомление о ключах"
                title="Закрыть"
                onClick={onDismiss}
            >
                <FiX aria-hidden="true" />
            </IconButton>
        </aside>
    )
}
