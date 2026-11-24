import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { FiRefreshCw } from "react-icons/fi"
import { AdminLayout } from "../admin/AdminLayout"
import { useAdminSession } from "../admin/useAdminSession"
import { SiteVisits, type SiteVisitStats } from "../admin/SiteVisits"
import {
    actionLabel,
    auditDetails,
    shortDate,
    uptime,
    type AdminHealth,
    type AuditEntry,
} from "../admin/data"
import { getApiBase } from "../config/apiBase"
import { formatFileSize } from "../config/releases"
import styles from "./AdminPage.module.css"

type Stats = {
    usersTotal: number
    blockedTotal: number
    usersByPlan: { plan: string; count: number }[]
    releasesPublished: number
    latestDownloads: Partial<
        Record<
            "darwin" | "win32",
            { version: string; url: string; fileSize: number; publishedAt: string | null }
        >
    >
}
export default function AdminDashboardPage() {
    const { authHeaders, isAdmin } = useAdminSession()
    const [stats, setStats] = useState<Stats | null>(null)
    const [health, setHealth] = useState<AdminHealth | null>(null)
    const [entries, setEntries] = useState<AuditEntry[] | null>(null)
    const [visits, setVisits] = useState<SiteVisitStats | null>(null)
    const [visitsUnavailable, setVisitsUnavailable] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const load = useCallback(
        async (signal?: AbortSignal) => {
            const read = async (path: string) => {
                const response = await fetch(`${getApiBase()}/admin/${path}`, {
                    headers: authHeaders(),
                    signal,
                })
                if (!response.ok) throw new Error()
                return response.json()
            }
            const results = await Promise.allSettled([
                read("stats"),
                read("health"),
                read("audit?limit=8"),
                read("visits"),
            ])
            if (signal?.aborted) return
            if (results[0].status === "fulfilled") {
                setStats(results[0].value.stats)
                setError(null)
            } else setError("Не удалось загрузить сводку.")
            setHealth(results[1].status === "fulfilled" ? results[1].value.health : null)
            setEntries(results[2].status === "fulfilled" ? results[2].value.entries : null)
            setVisits(results[3].status === "fulfilled" ? results[3].value.visits : null)
            setVisitsUnavailable(results[3].status === "rejected")
            setBusy(false)
        },
        [authHeaders]
    )
    useEffect(() => {
        const controller = new AbortController()
        if (isAdmin) void load(controller.signal)
        return () => controller.abort()
    }, [isAdmin, load])
    const services = health
        ? ([
              ["PostgreSQL", health.db],
              ["Redis", health.redis],
              ["nginx", health.nginx.available ? health.nginx.ok : null],
              ["pm2", health.pm2.available ? health.pm2.ok : null],
          ] as const)
        : []
    return (
        <AdminLayout
            title="Обзор"
            subtitle="Публикации и состояние сервиса"
            actions={
                <button
                    className={styles.btn}
                    disabled={busy}
                    onClick={() => {
                        setBusy(true)
                        void load()
                    }}
                >
                    <FiRefreshCw size={13} aria-hidden="true" />
                    Обновить
                </button>
            }
        >
            {error ? (
                <p className={styles.err} role="alert">
                    {error}
                </p>
            ) : null}
            {!stats && !error ? <p className={styles.muted}>Загрузка сводки…</p> : null}
            <SiteVisits visits={visits} unavailable={visitsUnavailable} />
            {stats ? (
                <>
                    <div className={styles.summaryLine}>
                        <Link to="/admin/people">
                            <strong>{stats.usersTotal}</strong>пользователей
                        </Link>
                        <Link to="/admin/people">
                            <strong>{stats.blockedTotal}</strong>заблокировано
                        </Link>
                        <Link to="/admin/release-panel">
                            <strong>{stats.releasesPublished}</strong>опубликованных сборок
                        </Link>
                    </div>
                    {health && (!health.ok || !health.recoveryMailConfigured) ? (
                        <div className={styles.attention}>
                            <span>
                                {!health.ok
                                    ? "Один из сервисов требует проверки."
                                    : "Не настроена почта для восстановления пароля."}
                            </span>
                            <Link to="/admin/system">Проверить настройки →</Link>
                        </div>
                    ) : null}
                    <div className={styles.columns}>
                        <section className={styles.flatSection}>
                            <div className={styles.sectionHeader}>
                                <h2 className={styles.panelTitle}>Доступно для скачивания</h2>
                                <Link to="/admin/release-panel">Управление релизами</Link>
                            </div>
                            <table className={styles.dataTable}>
                                <thead>
                                    <tr>
                                        <th>Платформа</th>
                                        <th>Версия</th>
                                        <th>Файл</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(["darwin", "win32"] as const).map((platform) => {
                                        const release = stats.latestDownloads[platform]
                                        return (
                                            <tr key={platform}>
                                                <td>
                                                    {platform === "darwin" ? "macOS" : "Windows"}
                                                </td>
                                                <td>
                                                    {release ? (
                                                        <>
                                                            <strong>{release.version}</strong>
                                                            <span className={styles.fileName}>
                                                                {release.publishedAt
                                                                    ? shortDate(release.publishedAt)
                                                                    : ""}
                                                            </span>
                                                        </>
                                                    ) : (
                                                        "Не опубликована"
                                                    )}
                                                </td>
                                                <td>
                                                    {release ? (
                                                        <a
                                                            className={styles.linkAction}
                                                            href={release.url}
                                                        >
                                                            {formatFileSize(release.fileSize)} ↓
                                                        </a>
                                                    ) : (
                                                        "—"
                                                    )}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </section>
                        <section className={styles.flatSection}>
                            <div className={styles.sectionHeader}>
                                <h2 className={styles.panelTitle}>Сервис</h2>
                                <Link to="/admin/system">Диагностика</Link>
                            </div>
                            {health ? (
                                <>
                                    <ul className={styles.serviceList}>
                                        {services.map(([name, ok]) => (
                                            <li className={styles.serviceRow} key={name}>
                                                <span>{name}</span>
                                                <span
                                                    className={`${styles.statusLabel} ${ok === true ? styles.good : ok === false ? styles.bad : ""}`}
                                                >
                                                    {ok === true
                                                        ? "Работает"
                                                        : ok === false
                                                          ? "Ошибка"
                                                          : "Не проверяется"}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                    <p className={styles.muted} style={{ marginTop: 12 }}>
                                        Без перезапуска {uptime(health.uptimeSec)} · проверено{" "}
                                        {shortDate(health.checkedAt)}
                                    </p>
                                </>
                            ) : (
                                <p className={styles.muted}>
                                    Статус недоступен. Откройте диагностику.
                                </p>
                            )}
                        </section>
                    </div>
                    <section className={styles.flatSection}>
                        <div className={styles.sectionHeader}>
                            <h2 className={styles.panelTitle}>Последние действия</h2>
                            <Link to="/admin/activity">Весь журнал</Link>
                        </div>
                        {entries ? (
                            entries.length ? (
                                <table className={styles.dataTable}>
                                    <thead>
                                        <tr>
                                            <th>Время</th>
                                            <th>Действие</th>
                                            <th>Объект</th>
                                            <th className={styles.desktopOnly}>Изменение</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {entries.slice(0, 8).map((entry) => (
                                            <tr key={entry.id}>
                                                <td className={styles.auditTime}>
                                                    {shortDate(entry.createdAt)}
                                                </td>
                                                <td>{actionLabel(entry.action)}</td>
                                                <td>
                                                    {entry.targetUsername ?? auditDetails(entry)}
                                                </td>
                                                <td className={styles.desktopOnly}>
                                                    {entry.targetUsername
                                                        ? auditDetails(entry)
                                                        : "—"}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <p className={styles.empty}>Действий пока нет.</p>
                            )
                        ) : (
                            <p className={styles.muted}>Не удалось загрузить журнал.</p>
                        )}
                    </section>
                    <div className={styles.sectionHeader}>
                        <h2 className={styles.panelTitle}>Аккаунты по тарифам</h2>
                        <Link to="/admin/plans">Условия тарифов</Link>
                    </div>
                    <div className={styles.planCounts}>
                        {stats.usersByPlan.map((row) => (
                            <span key={row.plan}>
                                {row.plan.charAt(0).toUpperCase() + row.plan.slice(1)}
                                <strong>{row.count}</strong>
                            </span>
                        ))}
                    </div>
                </>
            ) : null}
        </AdminLayout>
    )
}
