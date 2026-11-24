import { useCallback, useEffect, useState } from "react"
import { AdminLayout } from "../admin/AdminLayout"
import { useAdminSession } from "../admin/useAdminSession"
import { shortDate } from "../admin/data"
import { getApiBase } from "../config/apiBase"
import styles from "./AdminPage.module.css"

type Report = {
    id: string
    reporter: string | null
    reported: string | null
    reason: string
    created_at: string
    resolved_at: string | null
}
export default function AdminReportsPage() {
    const { authHeaders, isAdmin } = useAdminSession()
    const [reports, setReports] = useState<Report[] | null>(null)
    const [error, setError] = useState("")
    const [busy, setBusy] = useState(false)
    const [cursor, setCursor] = useState("")
    const load = useCallback(
        async (signal?: AbortSignal) => {
            try {
                const response = await fetch(
                    `${getApiBase()}/admin/reports${cursor ? "?beforeId=" + cursor : ""}`,
                    { headers: authHeaders(), signal }
                )
                if (!response.ok) throw new Error("Не удалось загрузить жалобы")
                const body = await response.json()
                if (!signal?.aborted) {
                    setReports(body.reports)
                    setError("")
                }
            } catch (error) {
                if (!signal?.aborted)
                    setError(error instanceof Error ? error.message : "Ошибка загрузки")
            }
        },
        [authHeaders, cursor]
    )
    useEffect(() => {
        const controller = new AbortController()
        if (isAdmin) void load(controller.signal)
        return () => controller.abort()
    }, [isAdmin, load])
    const resolve = async (report: Report) => {
        setBusy(true)
        try {
            const response = await fetch(`${getApiBase()}/admin/reports/${report.id}/resolve`, {
                method: "POST",
                headers: authHeaders(),
            })
            if (!response.ok) throw new Error("Не удалось закрыть жалобу")
            await load()
        } catch (error) {
            setError(error instanceof Error ? error.message : "Ошибка")
        } finally {
            setBusy(false)
        }
    }
    return (
        <AdminLayout
            title="Жалобы"
            subtitle="Обращения пользователей без автоматической передачи переписки"
            actions={
                <button className={styles.btn} disabled={busy} onClick={() => void load()}>
                    Обновить
                </button>
            }
        >
            {error && (
                <p className={styles.err} role="alert">
                    {error}
                </p>
            )}
            {!reports && !error && <p className={styles.empty}>Загрузка жалоб…</p>}
            {reports?.length === 0 && <p className={styles.empty}>На этой странице нет жалоб.</p>}
            {!!reports?.length && (
                <div className={styles.auditTableWrap}>
                    <table className={styles.auditTable}>
                        <thead>
                            <tr>
                                <th>Когда</th>
                                <th>От кого</th>
                                <th>На кого</th>
                                <th>Описание</th>
                                <th>Статус</th>
                            </tr>
                        </thead>
                        <tbody>
                            {reports.map((report) => (
                                <tr key={report.id}>
                                    <td data-label="Когда">{shortDate(report.created_at)}</td>
                                    <td data-label="От кого">
                                        {report.reporter || "Аккаунт удалён"}
                                    </td>
                                    <td data-label="На кого">
                                        {report.reported || "Аккаунт удалён"}
                                    </td>
                                    <td data-label="Описание" className={styles.auditDetails}>
                                        {report.reason}
                                    </td>
                                    <td data-label="Статус">
                                        {report.resolved_at ? (
                                            "Рассмотрена"
                                        ) : (
                                            <button
                                                className={styles.btn}
                                                disabled={busy}
                                                onClick={() => void resolve(report)}
                                            >
                                                Отметить рассмотренной
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <div className={styles.toolbar}>
                <button
                    className={styles.btn}
                    disabled={!cursor || busy}
                    onClick={() => setCursor("")}
                >
                    К новым
                </button>
                <button
                    className={styles.btn}
                    disabled={!reports || reports.length < 50 || busy}
                    onClick={() => setCursor(reports![reports!.length - 1].id)}
                >
                    Старее
                </button>
            </div>
        </AdminLayout>
    )
}
