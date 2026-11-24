import { useCallback, useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { FiArrowLeft } from "react-icons/fi"
import CheckoutForm from "../billing/CheckoutForm"
import CheckoutSummary from "../billing/CheckoutSummary"
import PaymentStatus from "../billing/PaymentStatus"
import { isPaidPlanSlug } from "../billing/billingApi"
import { restoreAttempt } from "../billing/checkoutSession"
import { useBillingCatalog } from "../billing/useBillingCatalog"
import { useCheckout } from "../billing/useCheckout"
import type { CheckoutOrder } from "../billing/types"
import styles from "../billing/Checkout.module.css"

export default function CheckoutPage() {
    const [search, setSearch] = useSearchParams()
    const queryOrder = search.get("order")
    const [initial] = useState(() => restoreAttempt(queryOrder, search.get("plan")))
    const [selected, setSelected] = useState(() => {
        const plan = initial?.planSlug ?? search.get("plan")
        return isPaidPlanSlug(plan) ? plan : "pro"
    })
    const { catalog, error: catalogError, retry: retryCatalog } = useBillingCatalog()
    const onOrder = useCallback(
        (order: CheckoutOrder) => {
            setSearch({ order: order.orderId }, { replace: true })
        },
        [setSearch]
    )
    const flow = useCheckout({ initial, onOrder })
    const plan = flow.order?.plan ?? catalog?.plans.find((plan) => plan.slug === selected)
    const missingCapability = !!queryOrder && !initial && !flow.attempt
    const mode = flow.order?.mode ?? catalog?.mode
    const enabled = catalog?.enabled && (catalog.mode === "test" || catalog.mode === "live")
    useEffect(() => {
        document.title = mode === "test" ? "Тестовая оплата · PlayTime" : "Оплата · PlayTime"
    }, [mode])
    const newPayment = () => {
        flow.reset()
        setSearch({ plan: selected }, { replace: true })
    }
    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <Link className={styles.brand} to="/">
                    <img src={`${import.meta.env.BASE_URL}assets/PlayTime.png`} alt="" />
                    PlayTime
                </Link>
                <Link className={styles.back} to="/#plans">
                    <FiArrowLeft aria-hidden="true" />К тарифам
                </Link>
            </header>
            <main className={styles.main}>
                {mode === "test" && (
                    <span className={styles.testPill}>Тестовая оплата: деньги не списываются</span>
                )}
                <h1 className={styles.title}>Оплата плана</h1>
                <p className={styles.lead}>Один календарный месяц. Без автопродления.</p>
                {missingCapability ? (
                    <section className={`${styles.status} ${styles.empty}`}>
                        <h2>Откройте исходную вкладку</h2>
                        <p className={styles.description}>
                            Продолжить оплату можно во вкладке, в которой вы её начали.
                        </p>
                        <Link className={styles.textLink} to="/#plans">
                            Вернуться к тарифам
                        </Link>
                    </section>
                ) : flow.order ? (
                    <div className={styles.layout}>
                        <CheckoutSummary plan={flow.order.plan} mode={flow.order.mode} />
                        <PaymentStatus
                            order={flow.order}
                            paused={flow.paused}
                            retrySeconds={flow.retrySeconds}
                            error={flow.error}
                            onRefresh={flow.restore}
                            onNewAttempt={newPayment}
                        />
                    </div>
                ) : flow.attempt?.orderId || flow.uncertain ? (
                    <section className={`${styles.status} ${styles.empty}`}>
                        <h2>Ожидаем подтверждения оплаты</h2>
                        <p className={styles.description}>
                            Дождитесь результата. Если вы уже заплатили, не оплачивайте повторно.
                        </p>
                        {flow.error ? (
                            <p className={styles.error} role="alert">
                                {flow.error}
                            </p>
                        ) : null}
                        {flow.needsLogin && <a className={styles.textLink} href={`${import.meta.env.BASE_URL}app/`} target="_blank" rel="noopener noreferrer">Войти в PlayTime</a>}
                        <button
                            className={styles.secondary}
                            onClick={flow.restore}
                            disabled={flow.busy || flow.retrySeconds > 0}
                        >
                            {flow.busy
                                ? "Проверяем…"
                                : flow.retrySeconds > 0
                                  ? `Повторить через ${flow.retrySeconds} с`
                                  : "Проверить статус"}
                        </button>
                    </section>
                ) : !catalog || !enabled || !plan || !mode ? (
                    <section className={`${styles.status} ${styles.empty}`}>
                        <h2>
                            {catalogError || catalog
                                ? "Оплата временно недоступна"
                                : "Загружаем условия…"}
                        </h2>
                        <p className={styles.description}>
                            {catalogError ?? "Попробуйте ещё раз чуть позже."}
                        </p>
                        <button className={styles.secondary} onClick={retryCatalog}>
                            Попробовать снова
                        </button>
                    </section>
                ) : (
                    <div className={styles.layout}>
                        <CheckoutSummary plan={plan} mode={mode} />
                        <CheckoutForm
                            mode={mode}
                            plan={plan}
                            plans={catalog.plans}
                            onPlanChange={(slug) => {
                                if (isPaidPlanSlug(slug)) setSelected(slug)
                            }}
                            onSubmit={flow.start}
                            busy={flow.busy}
                            retrySeconds={flow.retrySeconds}
                            error={flow.error}
                        />
                    </div>
                )}
            </main>
        </div>
    )
}
