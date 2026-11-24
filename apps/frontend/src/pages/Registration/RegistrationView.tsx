import styles from "../Auth/Auth.module.css"
import { Button, Checkbox, Input } from "../../ui"
import type { ChangeEvent } from "react"

type RegistrationViewProps = {
    username: string
    email: string
    error: string
    loading: boolean
    successText: boolean
    fadeOut: boolean
    countdown: number
    legalAccepted: boolean
    onLegalAcceptedChange: (v: boolean) => void
    onUsernameChange: (v: string) => void
    onEmailChange: (v: string) => void
    onPasswordChange: (v: string) => void
    onPasswordRepeatChange: (v: string) => void
    onRegister: () => void
    onBack: () => void
}

const LEGAL_TERMS_URL = "https://smeruxa.ru/playtime/legal/terms"
const LEGAL_PRIVACY_URL = "https://smeruxa.ru/playtime/legal/privacy"

export function RegistrationView({
    username,
    email,
    error,
    loading,
    successText,
    fadeOut,
    countdown,
    legalAccepted,
    onLegalAcceptedChange,
    onUsernameChange,
    onEmailChange,
    onPasswordChange,
    onPasswordRepeatChange,
    onRegister,
    onBack
}: RegistrationViewProps) {
    return (
        <div className={styles.body}>
            <div className={styles.mainWrapper}>
                <div className={styles.heading}>
                    <span className={styles.brand}>PlayTime</span>
                    <h1 className={styles.title}>Создать аккаунт</h1>
                    <p className={styles.description}>Ваши друзья и разговоры — на любом устройстве.</p>
                </div>
                <form
                    className={styles.loginForm}
                    onSubmit={(event) => {
                        event.preventDefault()
                        if (!loading && legalAccepted) onRegister()
                    }}
                >
                    <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel} htmlFor="nickname">
                            Никнейм
                        </label>
                        <Input
                            className={styles.authInput}
                            id="nickname"
                            value={username}
                            required
                            minLength={3}
                            maxLength={15}
                            disabled={loading}
                            placeholder="Введите никнейм"
                            autoComplete="username"
                            onChange={(e: ChangeEvent<HTMLInputElement>) => onUsernameChange(e.target.value)}
                        />
                    </div>
                    <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel} htmlFor="email">
                            Почта
                        </label>
                        <Input
                            className={styles.authInput}
                            id="email"
                            value={email}
                            required
                            maxLength={254}
                            disabled={loading}
                            type="email"
                            placeholder="Введите почту"
                            autoComplete="email"
                            onChange={(e: ChangeEvent<HTMLInputElement>) => onEmailChange(e.target.value)}
                        />
                    </div>
                    <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel} htmlFor="reg-password">
                            Пароль
                        </label>
                        <Input
                            className={styles.authInput}
                            id="reg-password"
                            type="password"
                            placeholder="Пароль · от 12 до 50 символов"
                            minLength={12}
                            maxLength={50}
                            autoComplete="new-password"
                            required
                            disabled={loading}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => onPasswordChange(e.target.value)}
                        />
                    </div>
                    <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel} htmlFor="reg-password-repeat">
                            Повторите пароль
                        </label>
                        <Input
                            className={styles.authInput}
                            id="reg-password-repeat"
                            type="password"
                            placeholder="Повторите пароль"
                            autoComplete="new-password"
                            required
                            maxLength={50}
                            disabled={loading}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => onPasswordRepeatChange(e.target.value)}
                        />
                    </div>
                    <Checkbox
                        className={styles.consent}
                        checked={legalAccepted}
                        onCheckedChange={onLegalAcceptedChange}
                        disabled={loading}
                    >
                        <span>
                            Принимаю{" "}
                            <a href={LEGAL_TERMS_URL} target="_blank" rel="noopener noreferrer">
                                пользовательское соглашение
                            </a>{" "}
                            и{" "}
                            <a href={LEGAL_PRIVACY_URL} target="_blank" rel="noopener noreferrer">
                                политику конфиденциальности
                            </a>
                        </span>
                    </Checkbox>
                    {error ? (
                        <div className={styles.error} role="alert">
                            {error}
                        </div>
                    ) : null}
                    {successText ? (
                        <Button variant="primary" disabled>
                            Успешно! Возвращение через {countdown} сек.
                        </Button>
                    ) : (
                        <div className={styles.loginForm} style={fadeOut ? { opacity: 0.5 } : undefined}>
                            <Button type="submit" variant="primary" disabled={loading || !legalAccepted}>
                                {loading ? "Регистрация..." : "Зарегистрироваться"}
                            </Button>
                            <button type="button" className={styles.backLink} disabled={loading} onClick={onBack}>
                                Вернуться
                            </button>
                        </div>
                    )}
                </form>
            </div>
        </div>
    )
}
