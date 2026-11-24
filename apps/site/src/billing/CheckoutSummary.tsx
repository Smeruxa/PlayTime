import { formatAmount } from "./billingApi"
import type { BillingMode, BillingPlan } from "./types"
import styles from "./Checkout.module.css"

export default function CheckoutSummary({ plan, mode }: { plan: BillingPlan; mode: BillingMode }) {
    return (
        <aside className={styles.summary} aria-label="Условия оплаты">
            <span className={styles.eyebrow}>Ваш план</span>
            <h2>{plan.displayName}</h2>
            <p className={styles.price}>
                {formatAmount(plan)} <span>за месяц</span>
            </p>
            <p className={styles.summaryText}>
                Все возможности плана будут доступны в вашем аккаунте после оплаты.
            </p>
            {mode === "test" && (
                <div className={styles.testNote}>
                    <strong>Тестовая оплата</strong>
                    <span>
                        Деньги не списываются. Тестовые возможности действуют в режиме тестирования.
                    </span>
                </div>
            )}
        </aside>
    )
}
