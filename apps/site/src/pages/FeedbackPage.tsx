import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { FiArrowLeft, FiArrowUpRight, FiCheck, FiFeather, FiFlag } from "react-icons/fi"
import { getApiBase } from "../config/apiBase"
import styles from "./FeedbackPage.module.css"

type Challenge = { token: string; readyAt: number }
export default function FeedbackPage() {
    const [kind, setKind] = useState("feature")
    const [challenge, setChallenge] = useState<Challenge | null>(null)
    const [error, setError] = useState("")
    const [busy, setBusy] = useState(false)
    const [sent, setSent] = useState("")
    const [description, setDescription] = useState("")
    const [retryAt, setRetryAt] = useState(0)
    const [now, setNow] = useState(() => Date.now())
    const success = useRef<HTMLHeadingElement>(null)
    const loadChallenge = useCallback(async (signal?: AbortSignal) => {
        setChallenge(null)
        try {
            const response = await fetch(`${getApiBase()}/feedback-api/challenge`, {
                signal,
                cache: "no-store",
            })
            const body = await response.json().catch(() => ({
                error:
                    response.status === 413
                        ? "Заявка слишком большая. Сократите описание."
                        : "Форма временно недоступна. Попробуйте позже.",
                retryAfter:
                    response.status === 429 ? Number(response.headers.get("Retry-After")) || 60 : 0,
            }))
            if (!response.ok) {
                if (body.retryAfter) setRetryAt(Date.now() + body.retryAfter * 1000)
                throw new Error(body.error || "Не удалось открыть форму")
            }
            if (!signal?.aborted) {
                setChallenge({ token: body.token, readyAt: Date.now() + 3000 })
                setError("")
            }
        } catch (err) {
            if (!signal?.aborted)
                setError(err instanceof Error ? err.message : "Не удалось открыть форму")
        }
    }, [])
    useEffect(() => {
        const controller = new AbortController()
        void loadChallenge(controller.signal)
        return () => controller.abort()
    }, [loadChallenge])
    useEffect(() => {
        if (Math.max(retryAt, challenge?.readyAt || 0) <= now) return
        const timer = window.setInterval(() => setNow(Date.now()), 1000)
        return () => window.clearInterval(timer)
    }, [retryAt, challenge, now])
    useEffect(() => {
        if (sent) success.current?.focus()
    }, [sent])
    const wait = Math.max(0, Math.ceil((retryAt - now) / 1000))
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!challenge || busy || Date.now() < challenge.readyAt || wait) return
        const form = new FormData(event.currentTarget)
        setBusy(true)
        setError("")
        try {
            const response = await fetch(`${getApiBase()}/feedback-api/tickets`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    kind,
                    title: form.get("title"),
                    description,
                    contact: form.get("contact"),
                    appVersion: form.get("appVersion"),
                    platform: form.get("platform"),
                    website: form.get("website"),
                    token: challenge.token,
                }),
            })
            const body = await response.json().catch(() => ({
                error:
                    response.status === 413
                        ? "Заявка слишком большая. Сократите описание."
                        : "Форма временно недоступна. Попробуйте позже.",
                retryAfter:
                    response.status === 429 ? Number(response.headers.get("Retry-After")) || 60 : 0,
            }))
            if (!response.ok) {
                if (body.retryAfter) setRetryAt(Date.now() + body.retryAfter * 1000)
                if (body.refreshChallenge) await loadChallenge()
                throw new Error(body.error || "Не удалось отправить заявку")
            }
            setSent(String(body.id))
            setRetryAt(Date.now() + body.cooldownSeconds * 1000)
        } catch (err) {
            setError(
                err instanceof Error ? err.message : "Нет связи с сервером. Попробуйте ещё раз."
            )
        } finally {
            setBusy(false)
        }
    }
    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <Link className={styles.brand} to="/">
                    <img src={`${import.meta.env.BASE_URL}assets/PlayTime.png`} alt="" />
                    PlayTime
                </Link>
                <Link className={styles.back} to="/">
                    <FiArrowLeft aria-hidden="true" /> На главную
                </Link>
            </header>
            <main className={styles.layout}>
                <div className={styles.intro}>
                    <span className={styles.eyebrow}>ОБРАТНАЯ СВЯЗЬ</span>
                    <h1>
                        Сделаем PlayTime
                        <br />
                        чуть лучше.
                    </h1>
                    <p>
                        Не хватает возможности или что-то работает не так? Расскажите — мы
                        разберёмся.
                    </p>
                    <div className={styles.asideNote}>
                        <FiFeather aria-hidden="true" />
                        <div>
                            <strong>Прямо к команде</strong>
                            <p>
                                Заявка попадёт прямо к команде. Контакт можно оставить, если вы
                                готовы уточнить детали.
                            </p>
                        </div>
                    </div>
                    <p className={styles.small}>
                        Не прикладывайте пароли, ключи и личную переписку.
                    </p>
                </div>
                {sent ? (
                    <section className={styles.success} aria-label="Заявка принята">
                        <span className={styles.successIcon}>
                            <FiCheck aria-hidden="true" />
                        </span>
                        <p className={styles.eyebrow}>ЗАЯВКА #{sent}</p>
                        <h2 ref={success} tabIndex={-1}>
                            Спасибо, получили.
                        </h2>
                        <p>
                            Разберём обращение и свяжемся с вами, если понадобится уточнение и вы
                            оставили контакт.
                        </p>
                        <Link className={styles.primary} to="/">
                            Вернуться на сайт <FiArrowUpRight aria-hidden="true" />
                        </Link>
                    </section>
                ) : (
                    <form className={styles.form} onSubmit={(event) => void submit(event)}>
                        <fieldset className={styles.kinds}>
                            <legend>Чем хотите поделиться?</legend>
                            {[
                                { id: "feature", title: "Предложить идею", icon: FiFeather },
                                { id: "bug", title: "Сообщить об ошибке", icon: FiFlag },
                            ].map(({ id, title, icon: Icon }) => (
                                <label
                                    key={id}
                                    className={`${styles.kind} ${kind === id ? styles.kindActive : ""}`}
                                >
                                    <input
                                        type="radio"
                                        name="kind"
                                        value={id}
                                        checked={kind === id}
                                        onChange={() => setKind(id)}
                                    />
                                    <Icon aria-hidden="true" />
                                    <span>{title}</span>
                                </label>
                            ))}
                        </fieldset>
                        <label className={styles.field}>
                            Тема
                            <input
                                name="title"
                                required
                                minLength={5}
                                maxLength={120}
                                placeholder={
                                    kind === "bug"
                                        ? "Что перестало работать?"
                                        : "Чего не хватает в PlayTime?"
                                }
                            />
                        </label>
                        <label className={styles.field}>
                            Описание
                            <textarea
                                name="description"
                                required
                                minLength={20}
                                maxLength={6000}
                                rows={6}
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder={
                                    kind === "bug"
                                        ? "Как повторить ошибку? Что ожидали увидеть и что произошло?"
                                        : "Как это должно работать и чем поможет вам?"
                                }
                            />
                            <span className={styles.counter}>{description.length} / 6000</span>
                        </label>
                        <div className={styles.context}>
                            <label className={styles.field}>
                                Устройство <span>необязательно</span>
                                <select name="platform" defaultValue="">
                                    <option value="">Выберите систему</option>
                                    <option>macOS</option>
                                    <option>Windows</option>
                                    <option>Linux</option>
                                    <option>Браузер</option>
                                </select>
                            </label>
                            <label className={styles.field}>
                                Версия PlayTime <span>необязательно</span>
                                <input
                                    name="appVersion"
                                    maxLength={40}
                                    placeholder="Например, 2.0.11"
                                />
                            </label>
                        </div>
                        <label className={`${styles.field} ${styles.contact}`}>
                            Как с вами связаться <span>необязательно</span>
                            <input
                                name="contact"
                                maxLength={160}
                                placeholder="Email или Telegram"
                                autoComplete="email"
                            />
                        </label>
                        <div className={styles.trap} aria-hidden="true">
                            <label>
                                Ваш сайт
                                <input name="website" tabIndex={-1} autoComplete="off" />
                            </label>
                        </div>
                        {error && (
                            <p role="alert" className={styles.error}>
                                {error}
                            </p>
                        )}
                        {!challenge && !busy && (
                            <button
                                type="button"
                                className={styles.retry}
                                disabled={!!wait}
                                onClick={() => void loadChallenge()}
                            >
                                Обновить форму
                            </button>
                        )}
                        <div className={styles.submitRow}>
                            <p>
                                Отправляя заявку, вы соглашаетесь с{" "}
                                <Link to="/legal/privacy">политикой конфиденциальности</Link>.
                            </p>
                            <button
                                className={styles.primary}
                                disabled={busy || !challenge || now < challenge.readyAt || !!wait}
                                type="submit"
                            >
                                {busy
                                    ? "Отправляем…"
                                    : wait
                                      ? `Повторить через ${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, "0")}`
                                      : "Отправить"}
                                <FiArrowUpRight aria-hidden="true" />
                            </button>
                        </div>
                    </form>
                )}
            </main>
            <footer className={styles.footer}>PlayTime · Место для ваших разговоров</footer>
        </div>
    )
}
