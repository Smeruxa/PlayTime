import type { ChangeEvent } from "react"
import { HoldDeleteButton } from "../../components/HoldDeleteButton/HoldDeleteButton"
import styles from "./ProfileAccount.module.css"

type ProfileAccountSectionProps = {
    deleteAccountPassword: string
    deleteAccountErr: string | null
    socketConnected: boolean
    busy: boolean
    onPasswordChange: (e: ChangeEvent<HTMLInputElement>) => void
    onHoldComplete: () => void
}

export function ProfileAccountSection(props: ProfileAccountSectionProps) {
    return (
        <div className={styles.form}>
            <p className={styles.hint}>Профиль, друзья, комнаты и переписки будут удалены безвозвратно.</p>
            <label className={styles.label} htmlFor="pf-delete-pwd">
                Пароль для подтверждения
                <input
                    id="pf-delete-pwd"
                    type="password"
                    className={styles.input}
                    autoComplete="current-password"
                    value={props.deleteAccountPassword}
                    onChange={props.onPasswordChange}
                    disabled={props.busy}
                    placeholder="Текущий пароль"
                />
            </label>
            <p className={styles.hint}>
                После ввода пароля удерживайте кнопку 3 секунды. Это действие нельзя отменить.
            </p>
            {props.deleteAccountErr ? (
                <p className={styles.error} role="alert">
                    {props.deleteAccountErr}
                </p>
            ) : null}
            <HoldDeleteButton
                disabled={props.busy || !props.socketConnected || !props.deleteAccountPassword.trim()}
                idleLabel={props.busy ? "Удаление…" : "Удерживайте, чтобы удалить"}
                holdingLabel="Удерживайте…"
                ariaLabel="Удалить аккаунт: удерживайте 3 секунды"
                trackClassName={styles.hold}
                onHoldComplete={props.onHoldComplete}
            />
        </div>
    )
}
