import { IoAlertCircleOutline, IoCheckmarkDoneOutline, IoCheckmarkOutline } from "react-icons/io5"
import type { DisplayMessage } from "../types"
import styles from "./MessageDeliveryStatus.module.css"

type Props = {
    message: DisplayMessage
    onRetry?: (clientId: string) => void
}

export function MessageDeliveryStatus({ message, onRetry }: Props) {
    if (message.delivery?.status === "sending") {
        return (
            <span className={styles.pending} role="status" aria-label="Отправляется" title="Отправляется">
                <span className={styles.spinner} aria-hidden="true" />
            </span>
        )
    }
    if (message.delivery?.status === "failed") {
        return (
            <button
                type="button"
                className={styles.retry}
                aria-label="Повторить отправку"
                title={message.delivery.error ?? "Не удалось отправить сообщение"}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => message.clientMessageId && onRetry?.(message.clientMessageId)}
            >
                <IoAlertCircleOutline aria-hidden="true" />
                <span>Повторить</span>
            </button>
        )
    }
    const label = message.read ? "Прочитано" : "Отправлено"
    return (
        <span className={message.read ? styles.read : styles.sent} aria-label={label} title={label}>
            {message.read ? <IoCheckmarkDoneOutline aria-hidden="true" /> : <IoCheckmarkOutline aria-hidden="true" />}
        </span>
    )
}
