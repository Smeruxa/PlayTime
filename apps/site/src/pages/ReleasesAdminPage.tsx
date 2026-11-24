import { Fragment, useCallback, useEffect, useState } from "react"
import { FiRefreshCw } from "react-icons/fi"
import { AdminLayout } from "../admin/AdminLayout"
import { useAdminSession } from "../admin/useAdminSession"
import { shortDate } from "../admin/data"
import { getApiBase } from "../config/apiBase"
import styles from "./AdminPage.module.css"

type Release = {
    id: number
    version: string
    platform: "darwin" | "win32"
    filename: string
    fileSize: number
    isPublished: boolean
    isLatest: boolean
    releaseNotes: string | null
    publishedAt: string | null
    createdAt: string
    downloadUrl: string
}
export default function ReleasesAdminPage() {
    const { authHeaders, isAdmin } = useAdminSession()
    const [rows, setRows] = useState<Release[]>([])
    const [platform, setPlatform] = useState<"darwin" | "win32">("darwin")
    const [query, setQuery] = useState("")
    const [editing, setEditing] = useState<number | null>(null)
    const [drafts, setDrafts] = useState<Record<number, string>>({})
    const [busy, setBusy] = useState<number | null>(null)
    const [loaded, setLoaded] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [message, setMessage] = useState<string | null>(null)
    const load = useCallback(
        async (signal?: AbortSignal) => {
            try {
                const response = await fetch(`${getApiBase()}/admin/releases`, {
                    headers: authHeaders(),
                    signal,
                })
                if (!response.ok) throw new Error()
                const body = (await response.json()) as { releases: Release[] }
                if (!signal?.aborted) {
                    setRows(body.releases)
                    setError(null)
                    setLoaded(true)
                }
            } catch {
                if (!signal?.aborted) {
                    setError("Не удалось загрузить релизы.")
                    setLoaded(true)
                }
            }
        },
        [authHeaders]
    )
    useEffect(() => {
        const controller = new AbortController()
        if (isAdmin) void load(controller.signal)
        return () => controller.abort()
    }, [isAdmin, load])
    const patch = async (release: Release, body: Record<string, unknown>) => {
        if (busy != null) return
        if (
            body.is_published === false &&
            !window.confirm(
                `Снять версию ${release.version} с публикации?${release.isLatest ? " Текущая сборка перестанет быть доступна для скачивания и обновлений." : ""}`
            )
        )
            return
        setBusy(release.id)
        setError(null)
        setMessage(null)
        try {
            const response = await fetch(`${getApiBase()}/admin/releases/${release.id}`, {
                method: "PATCH",
                headers: { ...authHeaders(), "Content-Type": "application/json" },
                body: JSON.stringify(body),
            })
            const result = (await response.json()) as { release?: Release; error?: string }
            if (!response.ok) throw new Error(result.error || "Не удалось сохранить релиз")
            if (result.release) {
                const updated = result.release
                setRows((previous) =>
                    previous.map((row) =>
                        row.id === updated.id
                            ? updated
                            : updated.isLatest && row.platform === updated.platform
                              ? { ...row, isLatest: false }
                              : row
                    )
                )
            } else await load()
            if ("release_notes" in body) {
                setEditing(null)
                setDrafts((previous) => {
                    const next = { ...previous }
                    delete next[release.id]
                    return next
                })
            }
            setMessage("Изменения сохранены.")
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Нет соединения с сервером")
        } finally {
            setBusy(null)
        }
    }
    const q = query.trim().toLowerCase()
    const visible = rows.filter(
        (row) =>
            row.platform === platform &&
            (!q ||
                `${row.version} ${row.filename} ${row.releaseNotes ?? ""}`
                    .toLowerCase()
                    .includes(q))
    )
    const current = rows.find((row) => row.platform === platform && row.isLatest && row.isPublished)
    return (
        <AdminLayout
            title="Релизы"
            subtitle="Публикация установщиков и обновлений"
            actions={
                <button className={styles.btn} onClick={() => void load()}>
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
            {message ? (
                <p className={styles.msgOk} role="status">
                    {message}
                </p>
            ) : null}
            <div className={styles.tabs} role="tablist" aria-label="Платформа релиза">
                {(["darwin", "win32"] as const).map((key) => (
                    <button
                        key={key}
                        type="button"
                        role="tab"
                        id={`tab-${key}`}
                        aria-selected={platform === key}
                        tabIndex={platform === key ? 0 : -1}
                        aria-controls="release-list"
                        className={`${styles.tab} ${platform === key ? styles.tabActive : ""}`}
                        onClick={() => setPlatform(key)}
                        onKeyDown={(event) => {
                            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
                                return
                            event.preventDefault()
                            const next =
                                event.key === "Home"
                                    ? "darwin"
                                    : event.key === "End"
                                      ? "win32"
                                      : key === "darwin"
                                        ? "win32"
                                        : "darwin"
                            setPlatform(next)
                            document.getElementById(`tab-${next}`)?.focus()
                        }}
                    >
                        {key === "darwin" ? "macOS" : "Windows"}
                        <span>{rows.filter((row) => row.platform === key).length}</span>
                    </button>
                ))}
            </div>
            <div className={styles.toolbar}>
                <input
                    className={styles.input}
                    aria-label="Поиск релизов"
                    placeholder="Версия или имя файла"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
                <span className={styles.muted}>
                    {current
                        ? `Текущая версия ${current.version}`
                        : loaded && !error
                          ? "Текущая версия не назначена"
                          : ""}
                </span>
            </div>
            <div
                id="release-list"
                role="tabpanel"
                aria-labelledby={`tab-${platform}`}
                className={styles.tableWrap}
            >
                <table className={`${styles.dataTable} ${styles.releaseTable}`}>
                    <thead>
                        <tr>
                            <th>Сборка</th>
                            <th>Публикация</th>
                            <th>Размер</th>
                            <th>Изменения</th>
                            <th>Действия</th>
                        </tr>
                    </thead>
                    <tbody>
                        {visible.map((release) => {
                            const draft = drafts[release.id] ?? release.releaseNotes ?? ""
                            return (
                                <Fragment key={release.id}>
                                    <tr>
                                        <td>
                                            <strong>{release.version}</strong>
                                            <span className={styles.fileName}>
                                                {release.filename}
                                            </span>
                                            {release.isLatest ? (
                                                <span className={styles.currentVersion}>
                                                    Текущая для{" "}
                                                    {platform === "darwin" ? "macOS" : "Windows"}
                                                </span>
                                            ) : null}
                                        </td>
                                        <td>
                                            <span
                                                className={`${styles.statusLabel} ${release.isPublished ? styles.good : ""}`}
                                            >
                                                {release.isPublished ? "Опубликована" : "Черновик"}
                                            </span>
                                            <span className={styles.fileName}>
                                                {release.publishedAt
                                                    ? shortDate(release.publishedAt)
                                                    : ""}
                                            </span>
                                        </td>
                                        <td className={styles.numeric}>
                                            {(release.fileSize / 1024 ** 2).toFixed(1)} МБ
                                        </td>
                                        <td>
                                            <button
                                                className={styles.linkAction}
                                                onClick={() =>
                                                    setEditing(
                                                        editing === release.id ? null : release.id
                                                    )
                                                }
                                                aria-expanded={editing === release.id}
                                            >
                                                {editing === release.id
                                                    ? "Закрыть описание"
                                                    : "Редактировать"}
                                            </button>
                                            <span className={styles.notePreview}>
                                                {release.releaseNotes || "Описание не добавлено"}
                                            </span>
                                        </td>
                                        <td>
                                            <div className={styles.releaseActions}>
                                                <button
                                                    className={styles.linkAction}
                                                    disabled={busy != null}
                                                    onClick={() =>
                                                        void patch(release, {
                                                            is_published: !release.isPublished,
                                                        })
                                                    }
                                                >
                                                    {release.isPublished
                                                        ? "Снять с публикации"
                                                        : "Опубликовать"}
                                                </button>
                                                {!release.isLatest ? (
                                                    <button
                                                        className={styles.linkAction}
                                                        disabled={busy != null}
                                                        onClick={() =>
                                                            void patch(release, {
                                                                is_latest: true,
                                                                is_published: true,
                                                            })
                                                        }
                                                    >
                                                        Сделать текущей
                                                    </button>
                                                ) : null}
                                                <a
                                                    href={release.downloadUrl}
                                                    className={styles.linkAction}
                                                >
                                                    Скачать файл
                                                </a>
                                            </div>
                                        </td>
                                    </tr>
                                    {editing === release.id ? (
                                        <tr>
                                            <td colSpan={5}>
                                                <div className={styles.releaseNotes}>
                                                    <label
                                                        htmlFor={`release-notes-${release.id}`}
                                                        className={styles.sectionTitle}
                                                    >
                                                        Описание версии {release.version}
                                                    </label>
                                                    <textarea
                                                        id={`release-notes-${release.id}`}
                                                        className={styles.input}
                                                        value={draft}
                                                        onChange={(e) =>
                                                            setDrafts((previous) => ({
                                                                ...previous,
                                                                [release.id]: e.target.value,
                                                            }))
                                                        }
                                                        rows={4}
                                                        maxLength={4000}
                                                    />
                                                    <div className={styles.actions}>
                                                        <button
                                                            className={styles.btnPrimary}
                                                            disabled={
                                                                busy != null ||
                                                                draft ===
                                                                    (release.releaseNotes ?? "")
                                                            }
                                                            onClick={() =>
                                                                void patch(release, {
                                                                    release_notes:
                                                                        draft.trim() || null,
                                                                })
                                                            }
                                                        >
                                                            Сохранить описание
                                                        </button>
                                                        <button
                                                            className={styles.btn}
                                                            onClick={() => setEditing(null)}
                                                        >
                                                            Закрыть
                                                        </button>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : null}
                                </Fragment>
                            )
                        })}
                    </tbody>
                </table>
                {!visible.length && !error ? (
                    <p className={styles.empty}>
                        {!loaded
                            ? "Загрузка релизов…"
                            : query
                              ? "По запросу ничего не найдено."
                              : "Сборок для этой платформы пока нет."}
                    </p>
                ) : null}
            </div>
        </AdminLayout>
    )
}
