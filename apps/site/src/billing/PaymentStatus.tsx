import { Link } from "react-router-dom"
import { confirmationUrl } from "./billingApi"
import type { CheckoutOrder } from "./types"
import styles from "./Checkout.module.css"

type Props = {
    order: CheckoutOrder
    retrySeconds: number
    paused: boolean
    error: string | null
    onRefresh: () => void
    onNewAttempt: () => void
}
const statusCopy = {
    creating: ["Готовим платёж", "Подождите немного, страница оплаты скоро откроется."],
    pending: ["Ожидаем оплату", "Завершите оплату, чтобы подключить план."],
    succeeded: ["План подключён", ""],
    canceled: ["Платёж отменён", "Вы можете попробовать снова или выбрать другой план."],
    review: [
        "Платёж проверяется",
        "Оплата пока не подтверждена. Если деньги списались, напишите нам. Повторно платить не нужно.",
    ],
    expired: [
        "Не удалось подтвердить оплату",
        "Если деньги списались, напишите нам. Поможем разобраться.",
    ],
} as const
export default function PaymentStatus({
    order,
    paused,
    retrySeconds,
    error,
    onRefresh,
    onNewAttempt,
}: Props) {
    const test = order.mode === "test"
    const [baseTitle, description] = statusCopy[order.status]
    const testTitles: Partial<Record<CheckoutOrder["status"], string>> = {
        creating: "Готовим тестовый платёж",
        pending: "Ожидаем тестовую оплату",
        succeeded: "Тестовая оплата подтверждена",
    }
    const title = (test && testTitles[order.status]) || baseTitle
    const url = order.status === "pending" ? confirmationUrl(order.confirmationUrl) : null
    const grant = order.status === "succeeded" ? order.grant : null
    return (
        <section
            className={styles.status}
            aria-labelledby="payment-status-title"
            aria-live="polite"
        >
            <span
                className={`${styles.statusMark} ${grant ? styles.successMark : ""}`}
                aria-hidden="true"
            >
                {grant ? "✓" : order.status === "canceled" ? "×" : "…"}
            </span>
            <h2 id="payment-status-title">{title}</h2>
            {grant ? (
                <>
                    <p className={styles.activation}>
                        {test ? "Тестовый" : "План"} {order.plan.displayName} активирован до{" "}
                        {new Intl.DateTimeFormat("ru-RU", {
                            dateStyle: "long",
                            timeStyle: "short",
                        }).format(new Date(grant.validUntil))}
                        .
                    </p>
                    <p className={styles.description}>
                        Аккаунт: <strong>{order.account.username}</strong>.{" "}
                        {test
                            ? "Действует в режиме тестирования."
                            : "План уже доступен в приложении. Без автопродления."}
                    </p>
                    <Link className={styles.primary} to="/app/" reloadDocument>
                        Открыть PlayTime
                    </Link>
                </>
            ) : (
                <p className={styles.description}>{description}</p>
            )}
            {url ? (
                <a className={styles.primary} href={url}>
                    {test ? "Продолжить тестовую оплату" : "Продолжить оплату"}
                </a>
            ) : null}
            {paused && !grant ? (
                <p className={styles.notice}>
                    Оплата ещё в обработке. Обновите статус через некоторое время.
                </p>
            ) : null}
            {error ? (
                <p className={styles.error} role="alert">
                    {error}
                </p>
            ) : null}
            {!grant && order.status !== "canceled" && order.status !== "expired" ? (
                <button
                    className={styles.secondary}
                    onClick={onRefresh}
                    disabled={retrySeconds > 0}
                >
                    {retrySeconds > 0 ? `Повторить через ${retrySeconds} с` : "Проверить статус"}
                </button>
            ) : null}
            {order.status === "review" || order.status === "expired" ? (
                <Link className={styles.secondary} to="/feedback">
                    Помощь с оплатой
                </Link>
            ) : null}
            {order.status === "canceled" ? (
                <button className={styles.primary} onClick={onNewAttempt}>
                    {test ? "Начать новую тестовую оплату" : "Начать новую оплату"}
                </button>
            ) : null}
            <Link className={styles.textLink} to="/#plans">
                Вернуться к тарифам
            </Link>
        </section>
    )
}
