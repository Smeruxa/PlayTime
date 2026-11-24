import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { abandonPendingGuest, enterGuest, pendingGuest } from "../../utils/api/enterGuest"
import { useSessionSocket } from "../../server/socketContext"
import { Button, Input } from "../../ui"
import styles from "./Auth.module.css"

export default function GuestPage() {
    const navigate = useNavigate()
    const { setToken } = useSessionSocket()
    const [username, setUsername] = useState(() => pendingGuest()?.username || "")
    const [error, setError] = useState("")
    const [busy, setBusy] = useState(false)
    const pending = useRef(false)
    const activeRequest = useRef<AbortController | null>(null)
    useEffect(() => () => activeRequest.current?.abort(), [])
    const submit = async () => {
        if (pending.current) return
        const name = username.trim()
        if (name.length < 3 || name.length > 15 || /[\s\u200B-\u200D\uFEFF]/.test(name)) {
            setError("Никнейм — от 3 до 15 символов без пробелов.")
            return
        }
        pending.current = true
        setBusy(true)
        setError("")
        const controller = new AbortController()
        activeRequest.current = controller
        try {
            const token = await enterGuest(name, controller.signal)
            if (controller.signal.aborted) return
            setToken(token)
            navigate("/content", { replace: true })
        } catch (err) {
            if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Нет соединения с сервером.")
        } finally {
            pending.current = false
            setBusy(false)
        }
    }
    return (
        <div className={styles.body}>
            <section className={styles.mainWrapper}>
                <div className={styles.heading}>
                    <span className={styles.brand}>PlayTime</span>
                    <h1 className={styles.title}>Как вас называть?</h1>
                    <p className={styles.description}>Выберите никнейм и присоединяйтесь к общению.</p>
                </div>
                <form
                    className={styles.loginForm}
                    onSubmit={(event) => {
                        event.preventDefault()
                        void submit()
                    }}
                >
                    <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel} htmlFor="guest-name">
                            Никнейм
                        </label>
                        <Input
                            id="guest-name"
                            className={styles.authInput}
                            value={username}
                            onChange={(event) => setUsername(event.target.value)}
                            autoComplete="nickname"
                            placeholder="Например, moonwalker"
                            minLength={3}
                            maxLength={15}
                            required
                            disabled={busy}
                            autoFocus
                        />
                        <p className={styles.fieldHint}>От 3 до 15 символов, без пробелов.</p>
                    </div>
                    <div className={styles.infoNote}>
                        Вход сохранится в этом браузере. Добавьте почту и пароль позже, чтобы не потерять доступ к
                        аккаунту.
                    </div>
                    {error && (
                        <div className={styles.error} role="alert">
                            {error}
                        </div>
                    )}
                    <Button className={styles.loginButton} type="submit" disabled={busy}>
                        {busy ? "Входим…" : "Начать общение"}
                    </Button>
                    <p className={styles.legalNote}>
                        Продолжая, вы принимаете{" "}
                        <a href="/playtime/legal/terms" target="_blank" rel="noreferrer">
                            пользовательское соглашение
                        </a>{" "}
                        и{" "}
                        <a href="/playtime/legal/privacy" target="_blank" rel="noreferrer">
                            политику конфиденциальности
                        </a>
                        .
                    </p>
                </form>
                <button
                    className={styles.backLink}
                    disabled={busy}
                    onClick={() => {
                        void abandonPendingGuest().catch(() => {})
                        navigate("/")
                    }}
                >
                    Другой способ входа
                </button>
            </section>
        </div>
    )
}
