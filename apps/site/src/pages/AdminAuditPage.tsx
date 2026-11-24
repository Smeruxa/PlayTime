import { useCallback, useEffect, useState } from "react"
import { FiRefreshCw } from "react-icons/fi"
import { AdminLayout } from "../admin/AdminLayout"
import { useAdminSession } from "../admin/useAdminSession"
import { actionLabel, auditDetails, shortDate, type AuditEntry } from "../admin/data"
import { getApiBase } from "../config/apiBase"
import styles from "./AdminPage.module.css"

const PAGE_SIZE = 40
export default function AdminAuditPage() {
    const { authHeaders, isAdmin } = useAdminSession()
    const [entries, setEntries] = useState<AuditEntry[] | null>(null)
    const [offset, setOffset] = useState(0)
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const load = useCallback(
        async (signal?: AbortSignal) => {
            try {
                const response = await fetch(
                    `${getApiBase()}/admin/audit?limit=${PAGE_SIZE}&offset=${offset}`,
                    { headers: authHeaders(), signal }
                )
                if (!response.ok) throw new Error()
                const body = (await response.json()) as { entries: AuditEntry[] }
                if (!signal?.aborted) {
                    setEntries(body.entries)
                    setError(null)
                }
            } catch {
                if (!signal?.aborted) setError("Не удалось загрузить журнал.")
            } finally {
                if (!signal?.aborted) setBusy(false)
            }
        },
        [authHeaders, offset]
    )
    useEffect(() => {
        const controller = new AbortController()
        if (isAdmin) void load(controller.signal)
        return () => controller.abort()
    }, [isAdmin, load])
    return (
        <AdminLayout
            title="Журнал"
            subtitle="Изменения пользователей, тарифов и публикаций"
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
            <div className={styles.auditTableWrap}>
                <table className={styles.auditTable}>
                    <thead>
                        <tr>
                            <th>Время</th>
                            <th>Действие</th>
                            <th>Объект</th>
                            <th>Изменение</th>
                            <th>Кто</th>
                        </tr>
                    </thead>
                    <tbody>
                        {entries?.map((entry) => (
                            <tr key={entry.id}>
                                <td data-label="Время" className={styles.auditTime}>
                                    {shortDate(entry.createdAt)}
                                </td>
                                <td data-label="Действие">{actionLabel(entry.action)}</td>
                                <td data-label="Объект">
                                    {entry.targetUsername ?? entry.targetUserId ?? "Релиз"}
                                </td>
                                <td data-label="Изменение" className={styles.auditDetails}>
                                    {auditDetails(entry)}
                                </td>
                                <td data-label="Кто">
                                    {entry.adminUsername ??
                                        entry.adminUserId ??
                                        String(entry.details.clientIp ?? "—")}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {!entries && !error ? (
                <p className={styles.empty}>Загрузка записей…</p>
            ) : entries && !entries.length ? (
                <p className={styles.empty}>На этой странице нет записей.</p>
            ) : null}
            <div
                className={styles.toolbar}
                style={{ marginTop: 20, justifyContent: "space-between" }}
            >
                <span className={styles.muted}>
                    {entries?.length ? `Записи ${offset + 1}–${offset + entries.length}` : ""}
                </span>
                <div className={styles.actions}>
                    <button
                        className={styles.btn}
                        disabled={busy || offset === 0}
                        onClick={() => {
                            setBusy(true)
                            setOffset((value) => Math.max(0, value - PAGE_SIZE))
                        }}
                    >
                        Новее
                    </button>
                    <button
                        className={styles.btn}
                        disabled={busy || (entries?.length ?? 0) < PAGE_SIZE}
                        onClick={() => {
                            setBusy(true)
                            setOffset((value) => value + PAGE_SIZE)
                        }}
                    >
                        Старее
                    </button>
                </div>
            </div>
        </AdminLayout>
    )
}
