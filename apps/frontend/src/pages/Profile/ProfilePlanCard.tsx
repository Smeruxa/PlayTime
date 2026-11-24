import type { PlanLimitsWire } from "../../types/subscription"
import { getPlanHighlights, getPlanTagline, PLAN_DISPLAY } from "./profilePlanPresentation"
import styles from "./Profile.module.css"

type ProfilePlanCardProps = {
    planSlug: string | null
    planLimits: PlanLimitsWire | null
}

export function ProfilePlanCard({ planSlug, planLimits }: ProfilePlanCardProps) {
    if (!planSlug && !planLimits) return null

    const title = planLimits?.displayName?.trim() || (planSlug ? PLAN_DISPLAY[planSlug] : null) || planSlug
    const tagline = getPlanTagline(planSlug)
    const highlights = getPlanHighlights(planSlug, planLimits)

    if (!title) return null

    return (
        <div className={styles.planCard}>
            <div className={styles.planCardHead}>
                <p className={styles.planCardLabel}>Ваш тариф</p>
                <span className={styles.planCardBadge}>{title}</span>
            </div>
            <p className={styles.planCardTagline}>{tagline}</p>
            {highlights.length > 0 ? (
                <dl className={styles.planCardStats}>
                    {highlights.map((h) => (
                        <div key={h.label} className={styles.planCardStat}>
                            <dt>{h.label}</dt>
                            <dd>{h.value}</dd>
                        </div>
                    ))}
                </dl>
            ) : null}
        </div>
    )
}
