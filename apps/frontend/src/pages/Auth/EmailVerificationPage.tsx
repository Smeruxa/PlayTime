import { useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { API_BASE } from "../../config"
import { fetchAuthJson } from "../../utils/api/requestDeadline"
import { Button, Input } from "../../ui"
import styles from "./Auth.module.css"
import { useAccountStatus } from "../../auth/AccountStatus"
import { useSessionSocket } from "../../server/socketContext"
import { CONFIRMATION_CODE_LENGTH, confirmationCodeInput, isConfirmationCode } from "../../auth/confirmationCode"

export default function EmailVerificationPage() {
    const [params] = useSearchParams()
    const navigate = useNavigate()
    const { account, reloadAccount } = useAccountStatus()
    const { token } = useSessionSocket()
    const upgrading = params.get("upgrade") === "1" && !!token
    const [email, setEmail] = useState(params.get("email") || "")
    const [code, setCode] = useState("")
    const [busy, setBusy] = useState(false)
    const [done, setDone] = useState(false)
    const [message, setMessage] = useState("")
    const [resendAt, setResendAt] = useState(0)
    const [refreshFailed, setRefreshFailed] = useState(false)
    const verificationEmail = upgrading ? account?.email || "" : email
    const refreshStatus = async () => {
        try {
            await reloadAccount()
            setRefreshFailed(false)
            setMessage("")
        } catch {
            setRefreshFailed(true)
            setMessage("Почта подтверждена. Не удалось обновить статус аккаунта — проверьте соединение и повторите.")
        }
    }
    const submit = async (confirm: boolean) => {
        if (busy || !verificationEmail) return
        if (confirm && !isConfirmationCode(code)) {
            setMessage("Введите код из письма: 6 цифр")
            return
        }
        setBusy(true)
        setMessage("")
        try {
            const { response, body } = await fetchAuthJson(
                `${API_BASE}/auth/email-verification/${confirm ? "confirm" : "request"}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: verificationEmail, code })
                }
            )
            if (!response.ok) throw new Error(body.error || "Не удалось подтвердить почту")
            if (confirm) {
                setDone(true)
                setCode("")
                if (upgrading) await refreshStatus()
            } else {
                setMessage("Если почта ожидает подтверждения, на неё придёт код. Проверьте папку Спам.")
                setResendAt(Date.now() + 60_000)
            }
        } catch (err) {
            setMessage(err instanceof Error ? err.message : "Нет соединения с сервером")
        } finally {
            setBusy(false)
        }
    }
    return (
        <div className={styles.body}>
            <section className={styles.mainWrapper}>
                <div className={styles.heading}>
                    <span className={styles.brand}>PlayTime</span>
                    <h1 className={styles.title}>{done ? "Почта подтверждена" : "Подтвердите почту"}</h1>
                    <p className={styles.description}>
                        {done
                            ? upgrading
                                ? "Аккаунт зарегистрирован. Можно продолжать общение — всё осталось на месте."
                                : "Теперь можно войти в аккаунт."
                            : "Введите код из письма. Он действует 15 минут."}
                    </p>
                </div>
                {!done && (
                    <form
                        className={styles.loginForm}
                        onSubmit={(event) => {
                            event.preventDefault()
                            void submit(true)
                        }}
                    >
                        <div className={styles.fieldGroup}>
                            <label className={styles.fieldLabel} htmlFor="verification-email">
                                Почта аккаунта
                            </label>
                            <Input
                                className={styles.authInput}
                                id="verification-email"
                                type="email"
                                autoComplete="email"
                                value={verificationEmail}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                disabled={busy}
                                readOnly={upgrading}
                            />
                        </div>
                        <div className={styles.fieldGroup}>
                            <label className={styles.fieldLabel} htmlFor="verification-code">
                                Код из письма
                            </label>
                            <Input
                                className={styles.authInput}
                                id="verification-code"
                                value={code}
                                onChange={(e) => setCode(confirmationCodeInput(e.target.value))}
                                autoComplete="one-time-code"
                                inputMode="numeric"
                                pattern="[0-9]{6}"
                                minLength={CONFIRMATION_CODE_LENGTH}
                                maxLength={CONFIRMATION_CODE_LENGTH}
                                placeholder="6 цифр"
                                required
                                disabled={busy}
                            />
                        </div>
                        <Button type="submit" disabled={busy || !verificationEmail}>
                            {busy ? "Проверяем…" : "Подтвердить почту"}
                        </Button>
                        <button
                            type="button"
                            className={styles.recoveryLink}
                            disabled={busy}
                            onClick={() => {
                                if (Date.now() < resendAt) setMessage("Новый код можно запросить через минуту.")
                                else void submit(false)
                            }}
                        >
                            Отправить код ещё раз
                        </button>
                    </form>
                )}
                {message && (
                    <p className={styles.description} role="status">
                        {message}
                    </p>
                )}
                {refreshFailed && (
                    <Button variant="secondary" onClick={() => void refreshStatus()}>
                        Обновить статус аккаунта
                    </Button>
                )}
                {upgrading && !done && (
                    <button
                        className={styles.recoveryLink}
                        disabled={busy || !account?.registrationPending}
                        onClick={() => navigate("/complete-account?change-email=1")}
                    >
                        Изменить почту
                    </button>
                )}
                <Button
                    variant={done ? "primary" : "secondary"}
                    disabled={busy}
                    onClick={() => navigate(upgrading ? "/content" : !window.electronAPI ? "/login" : "/")}
                >
                    {upgrading ? "Вернуться к общению" : "Перейти ко входу"}
                </Button>
            </section>
        </div>
    )
}
