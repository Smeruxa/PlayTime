import { useState } from "react"
import { API_BASE } from "../../config"
import { fetchAuthJson } from "../../utils/api/requestDeadline"
import { Button, Input } from "../../ui"
import { passwordPolicyError } from "../../../../shared/auth/passwordPolicy"
import { CONFIRMATION_CODE_LENGTH, confirmationCodeInput, isConfirmationCode } from "../../auth/confirmationCode"

export function PasswordRecovery({ onBack }: { onBack: () => void }) {
    const [email, setEmail] = useState("")
    const [code, setCode] = useState("")
    const [password, setPassword] = useState("")
    const [repeat, setRepeat] = useState("")
    const [sent, setSent] = useState(false)
    const [done, setDone] = useState(false)
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState("")
    const submit = async (reset: boolean) => {
        if (reset && !isConfirmationCode(code)) {
            setMessage("Введите код из письма: 6 цифр")
            return
        }
        const policyError = reset ? passwordPolicyError(password) : null
        if (policyError) {
            setMessage(policyError)
            return
        }
        if (reset && password !== repeat) {
            setMessage("Пароли не совпадают")
            return
        }
        setBusy(true)
        setMessage("")
        try {
            const { response, body } = await fetchAuthJson(`${API_BASE}/auth/recovery/${reset ? "reset" : "request"}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(
                    reset ? { email: email.trim(), code: code.trim(), password } : { email: email.trim() }
                )
            })
            if (!response.ok) throw new Error(body.error || "Не удалось восстановить доступ")
            if (reset) {
                setDone(true)
                setPassword("")
                setRepeat("")
                setCode("")
                setMessage("Пароль изменён. Войдите с новым паролем.")
            } else {
                setSent(true)
                setMessage(body.message || "Проверьте почту и папку Спам.")
            }
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "Нет соединения с сервером")
        } finally {
            setBusy(false)
        }
    }
    return (
        <form
            onSubmit={(e) => {
                e.preventDefault()
                if (!busy) void submit(sent)
            }}
            style={{ display: "grid", gap: 12, width: "100%" }}
        >
            <h2 style={{ margin: 0, fontSize: 19 }}>Восстановление доступа</h2>
            {!done ? (
                <>
                    <label htmlFor="recovery-email">Почта аккаунта</label>
                    <Input
                        id="recovery-email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        disabled={busy || sent}
                    />
                    {sent ? (
                        <>
                            <label htmlFor="recovery-code">Код из письма · 6 цифр</label>
                            <Input
                                id="recovery-code"
                                autoComplete="one-time-code"
                                value={code}
                                onChange={(e) => setCode(confirmationCodeInput(e.target.value))}
                                inputMode="numeric"
                                pattern="[0-9]{6}"
                                minLength={CONFIRMATION_CODE_LENGTH}
                                maxLength={CONFIRMATION_CODE_LENGTH}
                                required
                                disabled={busy}
                            />
                            <label htmlFor="recovery-password">Новый пароль · от 12 до 50 символов</label>
                            <Input
                                id="recovery-password"
                                type="password"
                                autoComplete="new-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                minLength={12}
                                maxLength={50}
                                required
                                disabled={busy}
                            />
                            <Input
                                aria-label="Повторите новый пароль"
                                type="password"
                                autoComplete="new-password"
                                value={repeat}
                                onChange={(e) => setRepeat(e.target.value)}
                                required
                                disabled={busy}
                            />
                        </>
                    ) : null}
                    <Button type="submit" disabled={busy}>
                        {busy ? "Подождите…" : sent ? "Изменить пароль" : "Отправить код"}
                    </Button>
                    {sent ? (
                        <Button
                            type="button"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => {
                                setSent(false)
                                setMessage("")
                            }}
                        >
                            Другой email или новый код
                        </Button>
                    ) : null}
                    <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
                        Для чтения старой переписки на новом устройстве потребуется резервная копия ключей.
                    </p>
                </>
            ) : null}
            {message ? (
                <p role="status" style={{ margin: 0, fontSize: 13 }}>
                    {message}
                </p>
            ) : null}
            <Button type="button" variant="secondary" onClick={onBack} disabled={busy}>
                Вернуться ко входу
            </Button>
        </form>
    )
}
