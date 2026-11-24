import type { ChangeEvent } from "react"
import styles from "./ProfileAccount.module.css"

type ProfilePasswordSectionProps = {
    currentPassword: string
    password: string
    passwordRepeat: string
    errorPassword: string | null
    successPassword: string | null
    saving: boolean
    disabled: boolean
    onCurrentChange: (e: ChangeEvent<HTMLInputElement>) => void
    onNewChange: (e: ChangeEvent<HTMLInputElement>) => void
    onRepeatChange: (e: ChangeEvent<HTMLInputElement>) => void
    onChangePassword: () => void
}

export function ProfilePasswordSection(props: ProfilePasswordSectionProps) {
    return (
        <form
            className={styles.form}
            onSubmit={(event) => {
                event.preventDefault()
                props.onChangePassword()
            }}
        >
            <p className={styles.hint}>Новый пароль будет использоваться для входа в ваш аккаунт.</p>
            <label className={styles.label}>
                Текущий пароль
                <input
                    type="password"
                    className={styles.input}
                    autoComplete="current-password"
                    value={props.currentPassword}
                    onChange={props.onCurrentChange}
                    disabled={props.saving}
                    required
                />
            </label>
            <label className={styles.label}>
                Новый пароль
                <input
                    type="password"
                    className={styles.input}
                    placeholder="От 12 до 50 символов"
                    minLength={12}
                    maxLength={50}
                    autoComplete="new-password"
                    value={props.password}
                    onChange={props.onNewChange}
                    disabled={props.saving}
                    required
                />
            </label>
            <label className={styles.label}>
                Повторите новый пароль
                <input
                    type="password"
                    className={styles.input}
                    autoComplete="new-password"
                    value={props.passwordRepeat}
                    onChange={props.onRepeatChange}
                    disabled={props.saving}
                    required
                />
            </label>
            {props.errorPassword ? (
                <p className={styles.error} role="alert">
                    {props.errorPassword}
                </p>
            ) : null}
            {props.successPassword ? (
                <p className={styles.message} role="status">
                    {props.successPassword}
                </p>
            ) : null}
            <div className={styles.actions}>
                <button
                    type="submit"
                    className={`${styles.button} ${styles.primary}`}
                    disabled={props.saving || props.disabled}
                >
                    {props.saving ? "Сохранение…" : "Изменить пароль"}
                </button>
            </div>
        </form>
    )
}
