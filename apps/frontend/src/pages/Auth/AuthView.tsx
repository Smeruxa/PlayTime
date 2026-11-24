import styles from "./Auth.module.css"
import { Button, Input } from "../../ui"
import { useState, type ChangeEvent } from "react"
import { PasswordRecovery } from "./PasswordRecovery"

type AuthViewProps = {
    error: string
    loading: boolean
    onEmailChange: (v: string) => void
    onPasswordChange: (v: string) => void
    onLogin: () => void
    onGoRegister: () => void
    onChooseMethod?: () => void
}

export function AuthView({
    error,
    loading,
    onEmailChange,
    onPasswordChange,
    onLogin,
    onGoRegister,
    onChooseMethod
}: AuthViewProps) {
    const [recovering, setRecovering] = useState(false)
    const onEmail = (e: ChangeEvent<HTMLInputElement>) => onEmailChange(e.target.value)
    const onPassword = (e: ChangeEvent<HTMLInputElement>) => onPasswordChange(e.target.value)

    return (
        <div className={styles.body}>
            <div className={styles.mainWrapper}>
                <div className={styles.heading}>
                    <span className={styles.brand}>PlayTime</span>
                    {!recovering ? (
                        <>
                            <h1 className={styles.title}>Вход в аккаунт</h1>
                            <p className={styles.description}>Введите почту и пароль, чтобы продолжить.</p>
                        </>
                    ) : null}
                </div>
                {recovering ? (
                    <PasswordRecovery onBack={() => setRecovering(false)} />
                ) : (
                    <>
                        <form
                            className={styles.loginForm}
                            onSubmit={(e) => {
                                e.preventDefault()
                                if (!loading) onLogin()
                            }}
                        >
                            <div className={styles.fieldGroup}>
                                <label className={styles.fieldLabel} htmlFor="email">
                                    Почта
                                </label>
                                <Input
                                    className={styles.authInput}
                                    id="email"
                                    type="email"
                                    placeholder="mail@example.com"
                                    autoComplete="email"
                                    onChange={onEmail}
                                    disabled={loading}
                                />
                            </div>
                            <div className={styles.fieldGroup}>
                                <div className={styles.passwordLabelRow}>
                                    <label className={styles.fieldLabel} htmlFor="password">
                                        Пароль
                                    </label>
                                    <button
                                        className={styles.recoveryLink}
                                        type="button"
                                        onClick={() => setRecovering(true)}
                                        disabled={loading}
                                    >
                                        Забыли пароль?
                                    </button>
                                </div>
                                <Input
                                    className={styles.authInput}
                                    id="password"
                                    type="password"
                                    placeholder="Введите пароль"
                                    autoComplete="current-password"
                                    onChange={onPassword}
                                    disabled={loading}
                                />
                            </div>
                            {error ? (
                                <div className={styles.error} role="alert">
                                    {error}
                                </div>
                            ) : null}
                            <Button className={styles.loginButton} type="submit" variant="primary" disabled={loading}>
                                {loading ? "Входим…" : "Войти"}
                            </Button>
                        </form>
                        <div className={styles.registration}>
                            <span>Нет аккаунта?</span>
                            <button className={styles.registrationLink} type="button" onClick={onGoRegister}>
                                Зарегистрироваться
                            </button>
                        </div>
                        {onChooseMethod && (
                            <button
                                type="button"
                                className={styles.backLink}
                                disabled={loading}
                                onClick={onChooseMethod}
                            >
                                Другой способ входа
                            </button>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}
