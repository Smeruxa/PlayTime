import type { FormEvent } from "react"
import { Link } from "react-router-dom"
import { useCheckoutAccount } from "./useCheckoutAccount"
import { formatAmount } from "./billingApi"
import type { BillingMode, BillingPlan, CheckoutRequest } from "./types"
import styles from "./Checkout.module.css"

type Props = {
    mode: BillingMode
    plan: BillingPlan
    plans: BillingPlan[]
    onPlanChange: (slug: string) => void
    onSubmit: (form: Pick<CheckoutRequest, "planSlug" | "username" | "email">) => void
    busy: boolean
    retrySeconds: number
    error: string | null
}
export default function CheckoutForm({
    mode,
    plan,
    plans,
    onPlanChange,
    onSubmit,
    busy,
    retrySeconds,
    error,
}: Props) {
    const identity = useCheckoutAccount()
    const submit = (event: FormEvent) => {
        event.preventDefault()
        if (!identity.account || busy || retrySeconds > 0) return
        onSubmit({
            planSlug: plan.slug,
            ...identity.account,
        })
    }
    return (
        <form
            className={styles.form}
            onSubmit={submit}
            aria-label={mode === "test" ? "Тестовая оплата плана" : "Оплата плана"}
        >
            <h2>Ваш аккаунт</h2>
            <p className={styles.description}>
                {identity.account
                    ? <>План будет подключён к аккаунту <strong>{identity.account.username}</strong> ({identity.account.email}).</>
                    : identity.error ?? "Проверяем аккаунт…"}
            </p>
            <label htmlFor="checkout-plan">Тариф</label>
            <select
                id="checkout-plan"
                value={plan.slug}
                onChange={(event) => onPlanChange(event.target.value)}
                disabled={busy}
            >
                {plans.map((item) => (
                    <option key={item.slug} value={item.slug}>
                        {item.displayName} · {formatAmount(item)} за месяц
                    </option>
                ))}
            </select>
            {identity.error && (
                <>
                    <a className={styles.textLink} href={`${import.meta.env.BASE_URL}app/`} target="_blank" rel="noopener noreferrer">Войти в PlayTime</a>
                    <button type="button" className={styles.secondary} onClick={identity.refresh}>Проверить аккаунт</button>
                </>
            )}
            {error ? (
                <p className={styles.error} role="alert">
                    {error}
                </p>
            ) : null}
            <button className={styles.primary} type="submit" disabled={!identity.account || busy || retrySeconds > 0}>
                {busy
                    ? "Готовим платёж…"
                    : retrySeconds > 0
                      ? `Повторить через ${retrySeconds} с`
                      : `${mode === "test" ? "Перейти к тестовой оплате" : "Перейти к оплате"} · ${formatAmount(plan)}`}
            </button>
            <p className={styles.legal}>
                <Link to="/legal/terms">Условия использования</Link>
                <Link to="/legal/privacy">Конфиденциальность</Link>
            </p>
        </form>
    )
}
