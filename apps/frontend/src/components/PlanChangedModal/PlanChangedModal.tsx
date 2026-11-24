import { useEffect, useState } from "react"
import styles from "./PlanChangedModal.module.css"

const PLAN_LABEL: Record<string, string> = {
    free: "Free",
    medium: "Medium",
    pro: "Pro",
    enterprise: "Enterprise"
}

const COUNTDOWN_SEC = 3

type PlanChangedModalProps = {
    planSlug: string
}

export function PlanChangedModal({ planSlug }: PlanChangedModalProps) {
    const [left, setLeft] = useState(COUNTDOWN_SEC)
    const label = PLAN_LABEL[planSlug] ?? planSlug

    useEffect(() => {
        try {
            window.windowControls?.focus?.()
        } catch {
        }
    }, [])

    useEffect(() => {
        if (left <= 0) {
            window.location.reload()
            return
        }
        const t = window.setTimeout(() => setLeft((n) => n - 1), 1000)
        return () => clearTimeout(t)
    }, [left])

    return (
        <div className={styles.overlay} role="alertdialog" aria-modal="true" aria-labelledby="plan-changed-title">
            <div className={styles.dialog}>
                <h2 id="plan-changed-title" className={styles.title}>
                    Обновили ваш тариф
                </h2>
                <p className={styles.text}>
                    Администратор PlayTime назначил вам план <span className={styles.plan}>{label}</span>. Чтобы лимиты
                    комнат, голоса, демонстрации экрана и профиля совпадали с новым тарифом, приложение перезагрузится
                    автоматически.
                </p>
                <div className={styles.count} aria-live="polite">
                    {left}
                </div>
                <p className={styles.hint}>Перезагрузка через {left}…</p>
                <button type="button" className={styles.btn} onClick={() => window.location.reload()}>
                    Обновить сейчас
                </button>
            </div>
        </div>
    )
}
