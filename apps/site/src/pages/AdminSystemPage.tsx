import { useCallback, useEffect, useState } from "react"
import { FiRefreshCw } from "react-icons/fi"
import { AdminLayout } from "../admin/AdminLayout"
import { useAdminSession } from "../admin/useAdminSession"
import { shortDate, uptime, type AdminHealth, type Probe } from "../admin/data"
import { getApiBase } from "../config/apiBase"
import styles from "./AdminPage.module.css"

export default function AdminSystemPage() {
    const { authHeaders, isAdmin } = useAdminSession()
    const [health, setHealth] = useState<AdminHealth | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const load = useCallback(
        async (signal?: AbortSignal) => {
            try {
                const response = await fetch(`${getApiBase()}/admin/health`, {
                    headers: authHeaders(),
                    signal,
                })
                if (!response.ok) throw new Error()
                const data = (await response.json()) as { health: AdminHealth }
                if (!signal?.aborted) {
                    setHealth(data.health)
                    setError(null)
                }
            } catch {
                if (!signal?.aborted) setError("Не удалось проверить состояние сервера.")
            } finally {
                if (!signal?.aborted) setBusy(false)
            }
        },
        [authHeaders]
    )
    useEffect(() => {
        const controller = new AbortController()
        if (isAdmin) {
            void load(controller.signal)
            const timer = window.setInterval(() => void load(controller.signal), 20_000)
            return () => {
                controller.abort()
                window.clearInterval(timer)
            }
        }
        return () => controller.abort()
    }, [isAdmin, load])
    const probeState = (probe: Probe): boolean | null => (probe.available ? probe.ok : null)
    const services: {
        name: string
        ok: boolean | null
        detail: string
        label?: string
        warning?: boolean
    }[] = health
        ? [
              { name: "PostgreSQL", ok: health.db, detail: "Подключение к базе данных" },
              { name: "Redis", ok: health.redis, detail: "Сессии и ограничения запросов" },
              {
                  name: health.pm2.name.endsWith(".service") ? "systemd" : "pm2",
                  ok: probeState(health.pm2),
                  detail:
                      health.pm2.detail ||
                      `${health.pm2.name} · перезапусков: ${health.pm2.restarts ?? "—"}`,
              },
              {
                  name: "nginx",
                  ok: probeState(health.nginx),
                  detail:
                      health.nginx.detail ||
                      `Прокси: HTTP ${health.nginx.proxyStatusCode ?? "—"} · ${health.nginx.proxyLatencyMs ?? "—"} мс`,
              },
              { name: "Сайт", ok: health.siteDist, detail: "Готовность статической сборки" },
              {
                  name: "Файлы релизов",
                  ok: health.releasesDir,
                  detail: "Доступ к каталогу установщиков",
              },
              {
                  name: "Миграции",
                  ok: probeState(health.migrations),
                  detail:
                      health.migrations.detail ||
                      `Применено: ${health.migrations.applied ?? "—"} · ожидают: ${health.migrations.pending ?? "—"}`,
              },
              {
                  name: "Письма восстановления",
                  ok: health.recoveryMailConfigured === true,
                  warning: true,
                  label: health.recoveryMailConfigured ? "SMTP настроен" : "SMTP не настроен",
                  detail: health.recoveryMailConfigured
                      ? "Доставка зависит от почтового сервера"
                      : "Укажите SMTP_HOST, SMTP_FROM и данные отправителя в конфигурации сервера",
              },
          ]
        : []
    return (
        <AdminLayout
            title="Система"
            subtitle="Проверка каждые 20 секунд"
            actions={
                <button
                    className={styles.btn}
                    onClick={() => {
                        setBusy(true)
                        void load()
                    }}
                    disabled={busy}
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
            {!health && !error ? <p className={styles.muted}>Проверяем сервисы…</p> : null}
            {health ? (
                <>
                    <div className={styles.sectionHeader}>
                        <span
                            className={`${styles.statusLabel} ${health.ok ? styles.good : styles.bad}`}
                        >
                            {health.ok ? "Основные сервисы работают" : "Требуется проверка"}
                        </span>
                        <span className={styles.muted}>{shortDate(health.checkedAt)}</span>
                    </div>
                    <section className={styles.flatSection}>
                        <table className={`${styles.dataTable} ${styles.serviceTable}`}>
                            <thead>
                                <tr>
                                    <th>Компонент</th>
                                    <th>Состояние</th>
                                    <th>Проверка</th>
                                </tr>
                            </thead>
                            <tbody>
                                {services.map((row) => (
                                    <tr key={row.name}>
                                        <td>{row.name}</td>
                                        <td>
                                            <span
                                                className={`${styles.statusLabel} ${row.ok === true ? styles.good : row.ok === false ? (row.warning ? styles.warning : styles.bad) : ""}`}
                                            >
                                                {row.label ??
                                                    (row.ok === true
                                                        ? "Работает"
                                                        : row.ok === false
                                                          ? "Ошибка"
                                                          : "Не проверяется")}
                                            </span>
                                        </td>
                                        <td className={styles.muted}>{row.detail}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </section>
                    <div className={styles.columns}>
                        <section className={styles.flatSection}>
                            <h2 className={styles.panelTitle}>Процесс</h2>
                            <dl className={styles.detailList}>
                                <dt>Окружение</dt>
                                <dd>{health.env}</dd>
                                <dt>Платформа</dt>
                                <dd>{health.platform}</dd>
                                <dt>Node.js</dt>
                                <dd>{health.nodeVersion}</dd>
                                <dt>Время работы</dt>
                                <dd>{uptime(health.uptimeSec)}</dd>
                                <dt>Память процесса</dt>
                                <dd>{health.memory.rssMb} МБ</dd>
                                <dt>Heap</dt>
                                <dd>
                                    {health.memory.heapUsedMb} / {health.memory.heapTotalMb} МБ
                                </dd>
                                <dt>Нагрузка, 1 / 5 / 15 мин</dt>
                                <dd>{health.loadAvg.join(" / ")}</dd>
                                {health.metrics && (
                                    <>
                                        <dt>Запросы / ошибки за минуту</dt>
                                        <dd>
                                            {health.metrics.requestsLastMinute} /{" "}
                                            {health.metrics.errorsLastMinute}
                                        </dd>
                                        <dt>Задержка API, p95</dt>
                                        <dd>{health.metrics.requestP95Ms ?? "—"} мс</dd>
                                        <dt>Задержка цикла Node.js, p95</dt>
                                        <dd>{health.metrics.eventLoopP95Ms} мс</dd>
                                        <dt>Пул БД: занято / ждут</dt>
                                        <dd>
                                            {health.metrics.dbPool.total -
                                                health.metrics.dbPool.idle}{" "}
                                            / {health.metrics.dbPool.waiting}
                                        </dd>
                                        <dt>Память Redis</dt>
                                        <dd>
                                            {health.metrics.redis
                                                ? `${health.metrics.redis.usedMb} / ${health.metrics.redis.limitMb} МБ`
                                                : "Нет данных"}
                                        </dd>
                                    </>
                                )}
                            </dl>
                        </section>
                        <section className={styles.flatSection}>
                            <h2 className={styles.panelTitle}>Диск и схема данных</h2>
                            <dl className={styles.detailList}>
                                <dt>Свободно на диске</dt>
                                <dd>
                                    {health.disk.freeGb != null
                                        ? `${health.disk.freeGb} из ${health.disk.totalGb} ГБ`
                                        : "Не проверяется"}
                                </dd>
                                <dt>Занято</dt>
                                <dd>
                                    {health.disk.usedPercent != null
                                        ? `${health.disk.usedPercent}%`
                                        : "—"}
                                </dd>
                                <dt>Последняя миграция</dt>
                                <dd>
                                    <code>{health.migrations.latestApplied ?? "—"}</code>
                                </dd>
                                {health.migrations.latestPending ? (
                                    <>
                                        <dt>Ожидает применения</dt>
                                        <dd>
                                            <code>{health.migrations.latestPending}</code>
                                        </dd>
                                    </>
                                ) : null}
                            </dl>
                            {health.disk.detail ? (
                                <p className={styles.muted}>{health.disk.detail}</p>
                            ) : null}
                        </section>
                    </div>
                    {!health.recoveryMailConfigured ? (
                        <p className={styles.attention}>
                            Восстановление пароля по почте недоступно до настройки SMTP. Остальные
                            функции приложения работают независимо от отправки писем.
                        </p>
                    ) : null}
                </>
            ) : null}
        </AdminLayout>
    )
}
