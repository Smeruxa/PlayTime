import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { FiArrowRight, FiUserPlus, FiX } from "react-icons/fi"
import { useAccountStatus } from "../../auth/AccountStatus"
import styles from "./GuestReminder.module.css"

export function GuestReminder() {
    const { account } = useAccountStatus()
    const navigate = useNavigate()
    const [dismissed, setDismissed] = useState<number | null>(null)
    if (!account?.isGuest) return null
    const key = `playtime:registration-reminder:${account.id}`
    const show = dismissed !== account.id && sessionStorage.getItem(key) !== "dismissed"
    const open = () => navigate("/complete-account")
    return (
        <div className={styles.anchor}>
            <button
                className={styles.trigger}
                aria-label="Зарегистрировать аккаунт"
                title="Зарегистрировать аккаунт"
                onClick={open}
                aria-describedby={show ? "guest-reminder" : undefined}
            >
                <FiUserPlus size={20} />
                <span className={styles.badge} aria-hidden>
                    !
                </span>
            </button>
            {show && (
                <aside id="guest-reminder" className={styles.tooltip} aria-label="Регистрация аккаунта">
                    <button
                        className={styles.close}
                        aria-label="Закрыть подсказку о регистрации"
                        onClick={() => {
                            sessionStorage.setItem(key, "dismissed")
                            setDismissed(account.id)
                        }}
                    >
                        <FiX size={16} />
                    </button>
                    <strong>{account.registrationPending ? "Подтвердите почту" : "Вы вошли по нику"}</strong>
                    <p>
                        {account.registrationPending
                            ? "Введите код из письма, чтобы завершить регистрацию."
                            : "Добавьте почту и пароль, чтобы сохранить доступ к аккаунту."}
                    </p>
                    <button className={styles.action} onClick={open}>
                        {account.registrationPending ? "Завершить регистрацию" : "Зарегистрироваться"}
                        <FiArrowRight size={14} aria-hidden />
                    </button>
                </aside>
            )}
        </div>
    )
}
