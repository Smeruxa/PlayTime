import { formatAdminCalendarDate } from "./data"
import styles from "./SiteVisits.module.css"

export type SiteVisitStats = {
    today: number
    week: number
    total: number
    enabledAt: string
    timeZone: "Europe/Moscow"
    sessionMinutes: number
}

const count = new Intl.NumberFormat("ru-RU")
export function SiteVisits({
    visits,
    unavailable,
}: {
    visits: SiteVisitStats | null
    unavailable: boolean
}) {
    return (
        <section className={styles.section} aria-labelledby="site-visits-title">
            <div className={styles.heading}>
                <h2 id="site-visits-title">Посещения сайта</h2>
                <span>По московскому времени</span>
            </div>
            <dl className={styles.metrics}>
                {(
                    [
                        ["Сегодня", visits?.today],
                        ["За 7 дней", visits?.week],
                        ["За всё время", visits?.total],
                    ] as const
                ).map(([label, value]) => (
                    <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value === undefined ? "—" : count.format(value)}</dd>
                    </div>
                ))}
            </dl>
            <p className={styles.note} role={unavailable ? "status" : undefined}>
                {unavailable
                    ? "Посещаемость временно недоступна. Остальная сводка продолжает работать."
                    : visits
                      ? `Один визит — до 30 минут бездействия. За 7 дней — включая сегодня. Учёт с ${formatAdminCalendarDate(visits.enabledAt) ?? "—"}`
                      : "Загрузка посещаемости…"}
            </p>
        </section>
    )
}
