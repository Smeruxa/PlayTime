import { useCallback, useEffect, useState, type FormEvent } from "react"
import { FiArrowUpRight, FiSearch, FiX } from "react-icons/fi"
import { AdminLayout } from "../admin/AdminLayout"
import { useAdminSession } from "../admin/useAdminSession"
import { getApiBase } from "../config/apiBase"
import common from "./AdminPage.module.css"
import styles from "./AdminTicketsPage.module.css"

const statusLabels: Record<string, string> = {
    new: "Новая",
    planned: "В планах",
    in_progress: "В работе",
    done: "Готово",
    declined: "Отклонена",
    spam: "Спам",
}
const priorityLabels: Record<string, string> = { low: "Низкий", normal: "Обычный", high: "Высокий" }
type Ticket = {
    id: string
    kind: string
    title: string
    description: string
    contact: string
    app_version: string
    platform: string
    status: string
    priority: string
    internal_note: string
    revision: number
    created_at: string
    updated_at: string
}
type Filters = { status: string; kind: string; priority: string; search: string }
const emptyFilters: Filters = { status: "", kind: "", priority: "", search: "" }
const date = (value: string) =>
    new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })

export default function AdminTicketsPage() {
    const { isAdmin, authHeaders } = useAdminSession()
    const [filters, setFilters] = useState<Filters>(emptyFilters)
    const [draftFilters, setDraftFilters] = useState<Filters>(emptyFilters)
    const [tickets, setTickets] = useState<Ticket[]>([])
    const [cursor, setCursor] = useState("")
    const [history, setHistory] = useState<string[]>([])
    const [nextCursor, setNextCursor] = useState<string | null>(null)
    const [selected, setSelected] = useState<Ticket | null>(null)
    const [status, setStatus] = useState("new")
    const [priority, setPriority] = useState("normal")
    const [note, setNote] = useState("")
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState("")
    const [message, setMessage] = useState("")
    const dirty =
        !!selected &&
        (status !== selected.status ||
            priority !== selected.priority ||
            note !== selected.internal_note)
    const load = useCallback(
        async (signal?: AbortSignal) => {
            setLoading(true)
            try {
                const query = new URLSearchParams({
                    ...filters,
                    ...(cursor ? { before: cursor } : {}),
                })
                const response = await fetch(`${getApiBase()}/admin/tickets?${query}`, {
                    headers: authHeaders(),
                    signal,
                    cache: "no-store",
                })
                const body = await response
                    .json()
                    .catch(() => ({ error: "Не удалось связаться с сервером. Попробуйте позже." }))
                if (!response.ok) throw new Error(body.error || "Не удалось загрузить заявки")
                if (!signal?.aborted) {
                    setTickets(body.tickets)
                    setNextCursor(body.nextCursor)
                    setError("")
                }
            } catch (err) {
                if (!signal?.aborted)
                    setError(err instanceof Error ? err.message : "Ошибка загрузки")
            } finally {
                if (!signal?.aborted) setLoading(false)
            }
        },
        [authHeaders, filters, cursor]
    )
    useEffect(() => {
        const controller = new AbortController()
        if (isAdmin) void load(controller.signal)
        return () => controller.abort()
    }, [isAdmin, load])
    function choose(ticket: Ticket | null) {
        setError("")
        setSelected(ticket)
        setStatus(ticket?.status || "new")
        setPriority(ticket?.priority || "normal")
        setNote(ticket?.internal_note || "")
        setMessage("")
    }
    async function save(event: FormEvent) {
        event.preventDefault()
        if (!selected || !dirty || saving) return
        setSaving(true)
        setError("")
        setMessage("")
        try {
            const response = await fetch(`${getApiBase()}/admin/tickets/${selected.id}`, {
                method: "PATCH",
                headers: { ...authHeaders(), "Content-Type": "application/json" },
                body: JSON.stringify({
                    status,
                    priority,
                    internalNote: note,
                    revision: selected.revision,
                }),
            })
            const body = await response
                .json()
                .catch(() => ({ error: "Не удалось связаться с сервером. Попробуйте позже." }))
            if (!response.ok) throw new Error(body.error || "Не удалось сохранить заявку")
            choose(body.ticket)
            await load()
            setMessage("Изменения сохранены")
        } catch (err) {
            setError(err instanceof Error ? err.message : "Не удалось сохранить заявку")
        } finally {
            setSaving(false)
        }
    }
    function apply(event: FormEvent) {
        event.preventDefault()
        if (dirty || saving) return
        setCursor("")
        setHistory([])
        choose(null)
        setFilters({ ...draftFilters })
    }
    return (
        <AdminLayout
            title="Тикеты"
            subtitle="Идеи и ошибки из приложения и с сайта"
            actions={
                <>
                    <a
                        className={common.btn}
                        href={`${import.meta.env.BASE_URL}feedback`}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Открыть форму <FiArrowUpRight aria-hidden="true" />
                    </a>
                    <button
                        className={common.btn}
                        disabled={loading || saving || dirty}
                        onClick={() => {
                            choose(null)
                            void load()
                        }}
                    >
                        Обновить
                    </button>
                </>
            }
        >
            <form className={styles.filters} aria-label="Фильтры тикетов" onSubmit={apply}>
                <label>
                    Тип
                    <select
                        className={common.select}
                        value={draftFilters.kind}
                        disabled={dirty || saving}
                        onChange={(e) => setDraftFilters({ ...draftFilters, kind: e.target.value })}
                    >
                        <option value="">Все типы</option>
                        <option value="feature">Идеи</option>
                        <option value="bug">Ошибки</option>
                    </select>
                </label>
                <label>
                    Статус
                    <select
                        className={common.select}
                        value={draftFilters.status}
                        disabled={dirty || saving}
                        onChange={(e) =>
                            setDraftFilters({ ...draftFilters, status: e.target.value })
                        }
                    >
                        <option value="">Все статусы</option>
                        {Object.entries(statusLabels).map(([id, label]) => (
                            <option key={id} value={id}>
                                {label}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    Приоритет
                    <select
                        className={common.select}
                        value={draftFilters.priority}
                        disabled={dirty || saving}
                        onChange={(e) =>
                            setDraftFilters({ ...draftFilters, priority: e.target.value })
                        }
                    >
                        <option value="">Любой</option>
                        {Object.entries(priorityLabels).map(([id, label]) => (
                            <option key={id} value={id}>
                                {label}
                            </option>
                        ))}
                    </select>
                </label>
                <label className={styles.search}>
                    Поиск
                    <input
                        className={common.input}
                        value={draftFilters.search}
                        maxLength={100}
                        disabled={dirty || saving}
                        placeholder="Тема, описание, контакт или номер"
                        onChange={(e) =>
                            setDraftFilters({ ...draftFilters, search: e.target.value })
                        }
                    />
                </label>
                <button className={common.btn} disabled={dirty || saving} type="submit">
                    <FiSearch aria-hidden="true" />
                    Найти
                </button>
            </form>
            {error && (
                <p className={common.err} role="alert">
                    {error}
                </p>
            )}
            {message && (
                <p className={common.msgOk} role="status">
                    {message}
                </p>
            )}
            <div className={`${styles.workspace} ${selected ? styles.withDetail : ""}`}>
                <section className={styles.queue} aria-label="Список тикетов" aria-busy={loading}>
                    <div className={styles.queueHead}>
                        <span>
                            {loading ? "Загрузка…" : `Заявок на странице: ${tickets.length}`}
                        </span>
                        <span>Сначала новые</span>
                    </div>
                    {!loading && !tickets.length && (
                        <p className={common.empty}>Заявок по этим фильтрам пока нет.</p>
                    )}
                    {tickets.map((ticket) => (
                        <button
                            key={ticket.id}
                            type="button"
                            className={`${styles.ticket} ${selected?.id === ticket.id ? styles.active : ""}`}
                            disabled={saving || (dirty && selected?.id !== ticket.id)}
                            onClick={() => choose(ticket)}
                            aria-pressed={selected?.id === ticket.id}
                        >
                            <span className={styles.ticketMeta}>
                                <span>
                                    #{ticket.id}{" "}
                                    <span className={styles.kind}>
                                        {ticket.kind === "bug" ? "Ошибка" : "Идея"}
                                    </span>
                                </span>
                                <time dateTime={ticket.created_at}>{date(ticket.created_at)}</time>
                            </span>
                            <strong>{ticket.title}</strong>
                            <span className={styles.excerpt}>{ticket.description}</span>
                            <span className={styles.ticketFoot}>
                                <span className={`${styles.status} ${styles[ticket.status] || ""}`}>
                                    {statusLabels[ticket.status]}
                                </span>
                                <span className={ticket.priority === "high" ? styles.high : ""}>
                                    {priorityLabels[ticket.priority]} приоритет
                                </span>
                            </span>
                        </button>
                    ))}
                    <div className={styles.pagination}>
                        <button
                            className={common.btn}
                            disabled={!history.length || loading || dirty || saving}
                            onClick={() => {
                                setCursor(history[history.length - 1])
                                setHistory(history.slice(0, -1))
                                choose(null)
                            }}
                        >
                            Новее
                        </button>
                        <button
                            className={common.btn}
                            disabled={!nextCursor || loading || dirty || saving}
                            onClick={() => {
                                setHistory([...history, cursor])
                                setCursor(nextCursor!)
                                choose(null)
                            }}
                        >
                            Старее
                        </button>
                    </div>
                </section>
                {selected ? (
                    <section className={styles.detail} aria-label={`Заявка #${selected.id}`}>
                        <div className={styles.detailHead}>
                            <span>
                                ЗАЯВКА #{selected.id} ·{" "}
                                {selected.kind === "bug" ? "ОШИБКА" : "ИДЕЯ"}
                            </span>
                            <button
                                aria-label="Закрыть заявку"
                                className={styles.close}
                                disabled={dirty || saving}
                                onClick={() => choose(null)}
                            >
                                <FiX />
                            </button>
                        </div>
                        <h2>{selected.title}</h2>
                        <p className={styles.description}>{selected.description}</p>
                        <dl className={styles.metadata}>
                            <div>
                                <dt>Контакт</dt>
                                <dd>{selected.contact || "Не указан"}</dd>
                            </div>
                            <div>
                                <dt>Устройство</dt>
                                <dd>
                                    {selected.platform || "Не указано"}
                                    {selected.app_version && ` · ${selected.app_version}`}
                                </dd>
                            </div>
                            <div>
                                <dt>Создана</dt>
                                <dd>{date(selected.created_at)}</dd>
                            </div>
                            <div>
                                <dt>Обновлена</dt>
                                <dd>{date(selected.updated_at)}</dd>
                            </div>
                        </dl>
                        <form
                            className={styles.edit}
                            onSubmit={(e) => void save(e)}
                            aria-label="Обработка заявки"
                        >
                            <div className={styles.editRow}>
                                <label>
                                    Статус
                                    <select
                                        className={common.select}
                                        value={status}
                                        disabled={saving}
                                        onChange={(e) => setStatus(e.target.value)}
                                    >
                                        {Object.entries(statusLabels).map(([id, label]) => (
                                            <option key={id} value={id}>
                                                {label}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label>
                                    Приоритет
                                    <select
                                        className={common.select}
                                        value={priority}
                                        disabled={saving}
                                        onChange={(e) => setPriority(e.target.value)}
                                    >
                                        {Object.entries(priorityLabels).map(([id, label]) => (
                                            <option key={id} value={id}>
                                                {label}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                            <label className={styles.note}>
                                Внутренняя заметка
                                <textarea
                                    className={common.input}
                                    rows={4}
                                    maxLength={4000}
                                    value={note}
                                    disabled={saving}
                                    onChange={(e) => setNote(e.target.value)}
                                    placeholder="Решение, детали или ссылка на задачу"
                                />
                            </label>
                            <p className={common.muted}>Заметка видна только администраторам.</p>
                            <div className={styles.saveRow}>
                                <button
                                    type="submit"
                                    className={common.btnPrimary}
                                    disabled={!dirty || saving}
                                >
                                    {saving ? "Сохраняем…" : "Сохранить"}
                                </button>
                                {dirty && (
                                    <button
                                        type="button"
                                        className={common.btn}
                                        disabled={saving}
                                        onClick={() => choose(selected)}
                                    >
                                        Отменить изменения
                                    </button>
                                )}
                            </div>
                        </form>
                    </section>
                ) : (
                    <div className={styles.placeholder}>
                        <span>↗</span>
                        <p>Выберите заявку</p>
                        <small>Описание, контакт и обработка появятся здесь.</small>
                    </div>
                )}
            </div>
        </AdminLayout>
    )
}
