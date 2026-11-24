import { useRef, useState } from "react"
import { Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { useAccountStatus } from "../../auth/AccountStatus"
import { useSessionSocket } from "../../server/socketContext"
import { API_BASE } from "../../config"
import { fetchAuthJson } from "../../utils/api/requestDeadline"
import { passwordPolicyError } from "../../../../shared/auth/passwordPolicy"
import { Button, Checkbox, Input } from "../../ui"
import styles from "./Auth.module.css"

export default function CompleteAccountPage() {
    const navigate = useNavigate()
    const [params] = useSearchParams()
    const { token } = useSessionSocket()
    const { account, reloadAccount } = useAccountStatus()
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [repeat, setRepeat] = useState("")
    const [accepted, setAccepted] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")
    const [savedEmail, setSavedEmail] = useState<string | null>(null)
    const pending = useRef(false)
    const changingEmail = params.get("change-email") === "1" && account?.registrationPending === true
    const verify = (address: string) => navigate(`/verify-email?upgrade=1&email=${encodeURIComponent(address)}`)
    if (account && !account.isGuest) return <Navigate to="/content" replace />
    const continueVerification = async (address: string) => {
        try {
            await reloadAccount()
            verify(address)
        } catch {
            setError("Данные сохранены. Не удалось обновить аккаунт — проверьте соединение и продолжите подтверждение.")
        }
    }
    const submit = async () => {
        if (pending.current || (!changingEmail && !accepted)) return
        const validation = changingEmail
            ? !password
                ? "Введите пароль, выбранный при регистрации."
                : null
            : passwordPolicyError(password)
        if (validation) {
            setError(validation)
            return
        }
        if (!changingEmail && password !== repeat) {
            setError("Пароли не совпадают.")
            return
        }
        pending.current = true
        setBusy(true)
        setError("")
        try {
            const { response, body } = await fetchAuthJson(
                `${API_BASE}/auth/guest/${changingEmail ? "change-email" : "upgrade"}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ email: email.trim().toLowerCase(), password })
                }
            )
            if (!response.ok)
                throw new Error(
                    body.error ||
                        (changingEmail ? "Не удалось изменить почту." : "Не удалось зарегистрировать аккаунт.")
                )
            const address = body.user?.email || email.trim().toLowerCase()
            setSavedEmail(address)
            await continueVerification(address)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Нет соединения с сервером.")
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
                    <h1 className={styles.title}>{changingEmail ? "Изменить почту" : "Сохраните свой аккаунт"}</h1>
                    <p className={styles.description}>
                        {changingEmail ? (
                            "Укажите новый адрес и пароль, выбранный при регистрации. Мы отправим новый код, а ваш аккаунт и переписка сохранятся."
                        ) : (
                            <>
                                Добавьте почту и пароль. Ваш никнейм{account?.username ? ` ${account.username}` : ""},
                                друзья и переписка останутся с вами.
                            </>
                        )}
                    </p>
                </div>
                {!account ? (
                    <>
                        <p className={styles.description} role="status">
                            Загружаем аккаунт…
                        </p>
                        <Button
                            variant="secondary"
                            onClick={() =>
                                void reloadAccount().catch(() =>
                                    setError("Нет соединения с сервером. Попробуйте ещё раз.")
                                )
                            }
                        >
                            Повторить
                        </Button>
                    </>
                ) : savedEmail ? (
                    <>
                        <div className={styles.infoNote}>
                            Новый код придёт на {savedEmail}. Осталось подтвердить почту.
                        </div>
                        <Button
                            disabled={busy}
                            onClick={async () => {
                                setBusy(true)
                                setError("")
                                await continueVerification(savedEmail)
                                setBusy(false)
                            }}
                        >
                            Продолжить подтверждение
                        </Button>
                    </>
                ) : account.registrationPending && !changingEmail ? (
                    <>
                        <div className={styles.infoNote}>
                            Остался один шаг — подтвердить почту {account.email} кодом из письма.
                        </div>
                        <Button onClick={() => verify(account.email || "")}>Подтвердить почту</Button>
                        <button
                            className={styles.recoveryLink}
                            onClick={() => navigate("/complete-account?change-email=1")}
                        >
                            Изменить почту
                        </button>
                    </>
                ) : (
                    <form
                        className={styles.loginForm}
                        onSubmit={(event) => {
                            event.preventDefault()
                            void submit()
                        }}
                    >
                        <div className={styles.fieldGroup}>
                            <label className={styles.fieldLabel} htmlFor="upgrade-email">
                                {changingEmail ? "Новая почта" : "Почта"}
                            </label>
                            <Input
                                id="upgrade-email"
                                className={styles.authInput}
                                type="email"
                                autoComplete="email"
                                placeholder="mail@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                maxLength={254}
                                disabled={busy}
                            />
                        </div>
                        <div className={styles.fieldGroup}>
                            <label className={styles.fieldLabel} htmlFor="upgrade-password">
                                {changingEmail ? "Пароль аккаунта" : "Пароль"}
                            </label>
                            <Input
                                id="upgrade-password"
                                className={styles.authInput}
                                type="password"
                                autoComplete={changingEmail ? "current-password" : "new-password"}
                                placeholder={
                                    changingEmail ? "Пароль, выбранный при регистрации" : "От 12 до 50 символов"
                                }
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                minLength={changingEmail ? undefined : 12}
                                maxLength={50}
                                disabled={busy}
                            />
                        </div>
                        {!changingEmail && (
                            <div className={styles.fieldGroup}>
                                <label className={styles.fieldLabel} htmlFor="upgrade-repeat">
                                    Повторите пароль
                                </label>
                                <Input
                                    id="upgrade-repeat"
                                    className={styles.authInput}
                                    type="password"
                                    autoComplete="new-password"
                                    placeholder="Ещё раз, чтобы не ошибиться"
                                    value={repeat}
                                    onChange={(e) => setRepeat(e.target.value)}
                                    required
                                    maxLength={50}
                                    disabled={busy}
                                />
                            </div>
                        )}
                        {!changingEmail && (
                            <Checkbox
                                className={styles.consent}
                                checked={accepted}
                                onCheckedChange={setAccepted}
                                disabled={busy}
                            >
                                <span>
                                    Принимаю{" "}
                                    <a href="/playtime/legal/terms" target="_blank" rel="noreferrer">
                                        соглашение
                                    </a>{" "}
                                    и{" "}
                                    <a href="/playtime/legal/privacy" target="_blank" rel="noreferrer">
                                        политику конфиденциальности
                                    </a>
                                </span>
                            </Checkbox>
                        )}
                        <Button
                            type="submit"
                            className={styles.loginButton}
                            disabled={busy || (!changingEmail && !accepted)}
                        >
                            {busy ? "Сохраняем…" : changingEmail ? "Изменить почту" : "Зарегистрировать аккаунт"}
                        </Button>
                    </form>
                )}
                {error && (
                    <div className={styles.error} role="alert">
                        {error}
                    </div>
                )}
                <button className={styles.backLink} disabled={busy} onClick={() => navigate("/content")}>
                    Вернуться к общению
                </button>
            </section>
        </div>
    )
}
