import { useCallback, useEffect, useRef, useState } from "react"
import { AdminLayout } from "../admin/AdminLayout"
import { formatAdminCalendarDate } from "../admin/data"
import { useAdminSession } from "../admin/useAdminSession"
import { getApiBase } from "../config/apiBase"
import styles from "./AdminPage.module.css"

type User = {
    id: number
    username: string
    email: string
    planSlug: string
    isBlocked: boolean
    createdAt: string | null
}
const plans = ["free", "medium", "pro", "enterprise"]
export default function AdminUsersPage() {
    const { authHeaders, isAdmin } = useAdminSession()
    const [query, setQuery] = useState("")
    const [users, setUsers] = useState<User[]>([])
    const [selected, setSelected] = useState<User | null>(null)
    const [plan, setPlan] = useState("free")
    const [note, setNote] = useState("")
    const [reason, setReason] = useState("")
    const [searching, setSearching] = useState(false)
    const [loadingUser, setLoadingUser] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [message, setMessage] = useState<string | null>(null)
    const registrationDate = formatAdminCalendarDate(selected?.createdAt ?? null)
    const requestCounters = useRef({ search: 0, user: 0 })
    const detailRef = useRef<HTMLDivElement>(null)
    const search = useCallback(
        async (value: string) => {
            const revision = ++requestCounters.current.search
            setSearching(true)
            try {
                const response = await fetch(
                    `${getApiBase()}/admin/users?query=${encodeURIComponent(value.trim())}&limit=30`,
                    { headers: authHeaders() }
                )
                if (!response.ok) throw new Error()
                const body = (await response.json()) as { users: User[] }
                if (revision === requestCounters.current.search) {
                    setUsers(body.users)
                    setError(null)
                }
            } catch {
                if (revision === requestCounters.current.search)
                    setError("Не удалось загрузить пользователей.")
            } finally {
                if (revision === requestCounters.current.search) setSearching(false)
            }
        },
        [authHeaders]
    )
    useEffect(() => {
        if (isAdmin) void search("")
        const counters = requestCounters.current
        return () => {
            counters.search++
            counters.user++
        }
    }, [isAdmin, search])
    const open = async (user: User) => {
        if (saving || selected?.id === user.id) return
        if (
            selected &&
            (plan !== selected.planSlug || note.trim()) &&
            !window.confirm("Изменения тарифа не сохранены. Открыть другого пользователя?")
        )
            return
        const revision = ++requestCounters.current.user
        setSelected(user)
        setLoadingUser(true)
        setError(null)
        setMessage(null)
        setNote("")
        try {
            const response = await fetch(`${getApiBase()}/admin/users/${user.id}/subscription`, {
                headers: authHeaders(),
            })
            if (!response.ok) throw new Error()
            const body = (await response.json()) as {
                planSlug: string
                isBlocked: boolean
                blockedReason: string | null
            }
            if (revision !== requestCounters.current.user) return
            setSelected({ ...user, planSlug: body.planSlug, isBlocked: body.isBlocked })
            setPlan(body.planSlug)
            setReason(body.blockedReason ?? "")
            if (window.matchMedia("(max-width: 650px)").matches)
                detailRef.current?.scrollIntoView({ block: "start", behavior: "instant" })
        } catch {
            if (revision === requestCounters.current.user)
                setError("Не удалось открыть данные пользователя.")
        } finally {
            if (revision === requestCounters.current.user) setLoadingUser(false)
        }
    }
    const update = async (block?: boolean) => {
        if (!selected || saving || loadingUser) return
        if (
            block === true &&
            !window.confirm(
                `Заблокировать ${selected.username}? Пользователь будет отключён на всех устройствах.`
            )
        )
            return
        setSaving(true)
        setError(null)
        setMessage(null)
        const id = selected.id
        try {
            const response = await fetch(
                `${getApiBase()}/admin/users/${id}/${block === undefined ? "subscription" : "block"}`,
                {
                    method: block === undefined ? "PUT" : "PATCH",
                    headers: { ...authHeaders(), "Content-Type": "application/json" },
                    body: JSON.stringify(
                        block === undefined
                            ? { plan_slug: plan, note: note.trim() || null }
                            : { blocked: block, reason: reason.trim() || null }
                    ),
                }
            )
            const body = (await response.json()) as { error?: string }
            if (!response.ok) throw new Error(body.error || "Не удалось сохранить изменения")
            const updated = {
                ...selected,
                ...(block === undefined ? { planSlug: plan } : { isBlocked: block }),
            }
            setSelected(updated)
            setUsers((previous) => previous.map((user) => (user.id === id ? updated : user)))
            setNote("")
            setMessage(
                block === undefined
                    ? "Тариф сохранён."
                    : block
                      ? "Пользователь заблокирован."
                      : "Блокировка снята."
            )
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : "Нет соединения с сервером")
        } finally {
            setSaving(false)
        }
    }
    return (
        <AdminLayout title="Пользователи" subtitle="Тариф и доступ к аккаунту">
            <form
                className={styles.toolbar}
                onSubmit={(event) => {
                    event.preventDefault()
                    void search(query)
                }}
            >
                <input
                    className={styles.input}
                    aria-label="Поиск пользователей по нику или email"
                    placeholder="Ник или email"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
                <button className={styles.btn} type="submit" disabled={searching}>
                    {searching ? "Поиск…" : "Найти"}
                </button>
            </form>
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
            <div className={styles.workspace}>
                <section className={styles.userPane} aria-label="Список аккаунтов">
                    <h2 className={styles.paneTitle}>
                        Аккаунты {users.length ? `· ${users.length}` : ""}
                    </h2>
                    <ul className={styles.userList}>
                        {users.map((user) => (
                            <li key={user.id}>
                                <button
                                    className={`${styles.userRow} ${selected?.id === user.id ? styles.userRowActive : ""}`}
                                    type="button"
                                    aria-pressed={selected?.id === user.id}
                                    onClick={() => void open(user)}
                                >
                                    <span>
                                        <strong>{user.username}</strong>
                                        <span className={styles.fileName}>{user.email}</span>
                                    </span>
                                    <span
                                        className={
                                            user.isBlocked ? styles.badgeDanger : styles.badge
                                        }
                                    >
                                        {user.isBlocked ? "Заблокирован" : user.planSlug}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                    {!users.length ? (
                        <p className={styles.emptyState}>
                            {searching
                                ? "Загрузка аккаунтов…"
                                : "Пользователи не найдены. Попробуйте другой запрос."}
                        </p>
                    ) : users.length === 30 ? (
                        <p className={styles.emptyState}>
                            Показаны первые 30 аккаунтов. Уточните запрос, чтобы найти нужный.
                        </p>
                    ) : null}
                </section>
                <section
                    className={styles.userDetail}
                    ref={detailRef}
                    aria-label="Настройки выбранного пользователя"
                >
                    {selected ? (
                        <>
                            <div className={styles.sectionHeader}>
                                <div className={styles.userIdentity}>
                                    <div className={styles.userIdentityHeading}>
                                        <h2>{selected.username}</h2>
                                        <p className={styles.muted}>
                                            Дата регистрации{" "}
                                            {registrationDate && selected.createdAt ? (
                                                <time dateTime={selected.createdAt}>
                                                    {registrationDate}
                                                </time>
                                            ) : (
                                                "—"
                                            )}
                                        </p>
                                    </div>
                                    <p className={styles.muted}>{selected.email}</p>
                                </div>
                                <span className={styles.muted}>id {selected.id}</span>
                            </div>
                            {loadingUser ? (
                                <p className={styles.empty}>Загрузка данных…</p>
                            ) : (
                                <>
                                    <div className={styles.sectionDivider} />
                                    <form
                                        onSubmit={(event) => {
                                            event.preventDefault()
                                            void update()
                                        }}
                                    >
                                        <h3 className={styles.sectionTitle}>Тариф</h3>
                                        <div className={styles.fieldCol}>
                                            <label htmlFor="admin-plan" className={styles.muted}>
                                                Текущий тариф
                                            </label>
                                            <select
                                                id="admin-plan"
                                                className={styles.select}
                                                value={plan}
                                                onChange={(e) => setPlan(e.target.value)}
                                                disabled={saving}
                                            >
                                                {plans.map((slug) => (
                                                    <option key={slug} value={slug}>
                                                        {slug.charAt(0).toUpperCase() +
                                                            slug.slice(1)}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className={styles.fieldCol}>
                                            <label htmlFor="admin-note" className={styles.muted}>
                                                Комментарий к изменению
                                            </label>
                                            <input
                                                id="admin-note"
                                                className={styles.input}
                                                value={note}
                                                maxLength={500}
                                                onChange={(e) => setNote(e.target.value)}
                                                placeholder="Сохранится в журнале"
                                                disabled={saving}
                                            />
                                        </div>
                                        <button
                                            className={styles.btnPrimary}
                                            type="submit"
                                            disabled={
                                                saving ||
                                                (plan === selected.planSlug && !note.trim())
                                            }
                                        >
                                            {saving ? "Сохранение…" : "Сохранить тариф"}
                                        </button>
                                    </form>
                                    <div className={styles.sectionDivider} />
                                    <div className={styles.sectionHeader}>
                                        <h3 className={styles.sectionTitle}>Доступ к аккаунту</h3>
                                        <span
                                            className={`${styles.statusLabel} ${selected.isBlocked ? styles.bad : styles.good}`}
                                        >
                                            {selected.isBlocked ? "Заблокирован" : "Разрешён"}
                                        </span>
                                    </div>
                                    <details>
                                        <summary className={styles.linkAction}>
                                            Управление доступом
                                        </summary>
                                        <p className={styles.fieldHint}>
                                            {selected.isBlocked
                                                ? "Разблокировка позволит пользователю снова войти в приложение."
                                                : "Блокировка завершит сессии пользователя на всех устройствах."}
                                        </p>
                                        <div className={styles.fieldCol}>
                                            <label className={styles.muted} htmlFor="block-reason">
                                                Причина
                                            </label>
                                            <input
                                                id="block-reason"
                                                className={styles.input}
                                                value={reason}
                                                onChange={(e) => setReason(e.target.value)}
                                                maxLength={500}
                                                disabled={saving || selected.isBlocked}
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            className={`${styles.btn} ${!selected.isBlocked ? styles.btnDanger : ""}`}
                                            disabled={saving}
                                            onClick={() => void update(!selected.isBlocked)}
                                        >
                                            {selected.isBlocked
                                                ? "Снять блокировку"
                                                : "Заблокировать аккаунт"}
                                        </button>
                                    </details>
                                </>
                            )}
                        </>
                    ) : (
                        <p className={styles.emptyState}>
                            Выберите аккаунт слева, чтобы изменить тариф или проверить доступ.
                        </p>
                    )}
                </section>
            </div>
        </AdminLayout>
    )
}
