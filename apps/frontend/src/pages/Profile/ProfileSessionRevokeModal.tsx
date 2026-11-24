import { useEffect, useId, useState } from "react"
import { API_BASE } from "../../config"
import { Modal } from "../../ui"
import styles from "./ProfileAccount.module.css"
import { CONFIRMATION_CODE_LENGTH, confirmationCodeInput, isConfirmationCode } from "../../auth/confirmationCode"

export type SessionRevokeTarget = { id: string; deviceName: string; current: boolean } | "others"
type Props = {
    open: boolean
    target: SessionRevokeTarget
    token: string
    onClose: () => void
    onConfirmed: () => Promise<void>
}

export function ProfileSessionRevokeModal({ open, target, token, onClose, onConfirmed }: Props) {
    const inputId = useId()
    const [challenge, setChallenge] = useState<{ id: string; email: string; expiresAt: number } | null>(null)
    const [code, setCode] = useState("")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")
    const [resendAt, setResendAt] = useState(0)
    const [now, setNow] = useState(Date.now())
    useEffect(() => {
        if (!open) return
        setNow(Date.now())
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
    }, [open])
    const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000))
    const expired = !!challenge && now >= challenge.expiresAt
    const requestCode = async () => {
        setBusy(true)
        setError("")
        try {
            const response = await fetch(`${API_BASE}/auth/sessions/revocation-code`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify(target === "others" ? { allOthers: true } : { sessionId: target.id })
            })
            const body = await response.json()
            if (typeof body.retryAfter === "number") setResendAt(Date.now() + body.retryAfter * 1000)
            if (!response.ok) throw new Error(body.error || "Не удалось отправить код")
            const expiresAt = Date.parse(body.expiresAt)
            if (typeof body.challengeId !== "string" || !Number.isFinite(expiresAt))
                throw new Error("Не удалось запросить код")
            setChallenge({ id: body.challengeId, email: body.email, expiresAt })
            setCode("")
            setNow(Date.now())
        } catch (err) {
            setError(err instanceof Error ? err.message : "Не удалось отправить код")
        } finally {
            setBusy(false)
        }
    }
    const confirm = async () => {
        if (!challenge || expired || !isConfirmationCode(code)) return
        setBusy(true)
        setError("")
        try {
            const response = await fetch(
                `${API_BASE}/auth/sessions/${target === "others" ? "revoke-others" : target.id + "/revoke"}`,
                {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ challengeId: challenge.id, code })
                }
            )
            const body = await response.json()
            if (!response.ok) throw new Error(body.error || "Не удалось завершить сеанс")
            await onConfirmed()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Не удалось завершить сеанс")
        } finally {
            setBusy(false)
        }
    }
    return (
        <Modal
            open={open}
            title={target === "others" ? "Завершить остальные сеансы" : "Завершить сеанс?"}
            panelClassName={styles.modal}
            onClose={() => {
                if (!busy) onClose()
            }}
            footer={
                <>
                    <button type="button" className={styles.button} disabled={busy} onClick={onClose}>
                        Отмена
                    </button>
                    {challenge ? (
                        <button
                            type="button"
                            className={`${styles.button} ${styles.primary}`}
                            disabled={busy || expired || !isConfirmationCode(code)}
                            onClick={() => void confirm()}
                        >
                            {busy ? "Подождите…" : "Подтвердить отключение"}
                        </button>
                    ) : (
                        <button
                            type="button"
                            className={`${styles.button} ${styles.primary}`}
                            disabled={busy || remaining > 0}
                            onClick={() => void requestCode()}
                        >
                            {busy
                                ? "Отправка…"
                                : remaining > 0
                                  ? `Повторить через ${remaining} с`
                                  : "Отправить код на почту"}
                        </button>
                    )}
                </>
            }
        >
            <div className={styles.modalBody}>
                <p className={styles.hint}>
                    {target === "others" ? (
                        "Все остальные устройства выйдут из аккаунта. Этот сеанс останется активным."
                    ) : (
                        <>
                            Устройство <strong>{target.deviceName}</strong> выйдет из аккаунта. Для следующего входа
                            понадобится пароль.
                        </>
                    )}
                </p>
                <p className={styles.hint} role="status">
                    {challenge
                        ? `Код отправлен на ${challenge.email}. Он действует 10 минут и подтверждает только это действие.`
                        : "Подтвердите отключение кодом с почты аккаунта."}
                </p>
                {challenge ? (
                    <>
                        <label className={styles.label} htmlFor={inputId}>
                            Код из письма · 6 цифр
                            <input
                                id={inputId}
                                className={`${styles.input} ${styles.code}`}
                                autoComplete="one-time-code"
                                autoFocus
                                value={code}
                                inputMode="numeric"
                                pattern="[0-9]{6}"
                                minLength={CONFIRMATION_CODE_LENGTH}
                                maxLength={CONFIRMATION_CODE_LENGTH}
                                disabled={busy}
                                onChange={(event) => setCode(confirmationCodeInput(event.target.value))}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter" && !busy) {
                                        event.preventDefault()
                                        void confirm()
                                    }
                                }}
                            />
                        </label>
                        <div>
                            <button
                                type="button"
                                className={`${styles.button} ${styles.link}`}
                                disabled={busy || remaining > 0}
                                onClick={() => void requestCode()}
                            >
                                {remaining > 0 ? `Отправить повторно через ${remaining} с` : "Отправить код повторно"}
                            </button>
                        </div>
                    </>
                ) : null}
                {expired ? <p className={styles.error}>Срок действия кода истёк. Запросите новый.</p> : null}
                {error ? (
                    <p className={styles.error} role="alert">
                        {error}
                    </p>
                ) : null}
            </div>
        </Modal>
    )
}
