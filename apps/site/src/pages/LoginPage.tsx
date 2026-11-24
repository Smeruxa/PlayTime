import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { AdminAccessError, checkAdminAccess } from "../auth/adminLogin"
import { getApiBase } from "../config/apiBase"
import "../styles/admin-theme.css"
import styles from "./LoginPage.module.css"

export default function LoginPage() {
    const navigate = useNavigate()
    const [attempt, setAttempt] = useState(0)
    const [error, setError] = useState<string | null>(null)
    const [reason, setReason] = useState<AdminAccessError["reason"] | null>(null)
    useEffect(() => {
        const controller = new AbortController()
        void checkAdminAccess(getApiBase(), controller.signal)
            .then(() => {
                if (!controller.signal.aborted) navigate("/admin/panel", { replace: true })
            })
            .catch((reason: unknown) => {
                if (!controller.signal.aborted) {
                    setReason(reason instanceof AdminAccessError ? reason.reason : "unavailable")
                    setError(
                        reason instanceof Error ? reason.message : "Не удалось проверить доступ."
                    )
                }
            })
        return () => controller.abort()
    }, [navigate, attempt])
    const restricted = reason === "unauthenticated" || reason === "denied"
    return (
        <main className={`adminRoot ${styles.wrap}`}>
            <div className={styles.card}>
                <p className={styles.eyebrow}>PlayTime · Администрирование</p>
                <h1 className={styles.title}>
                    {restricted
                        ? "Доступ ограничен"
                        : error
                          ? "Сервер недоступен"
                          : "Проверяем подключение"}
                </h1>
                <p className={styles.hint}>
                    {restricted
                        ? "У вас нет доступа к этой странице."
                        : (error ?? "Проверяем сессию администратора.")}
                </p>
                {error && !restricted ? (
                    <button
                        className={styles.btn}
                        type="button"
                        onClick={() => {
                            setError(null)
                            setReason(null)
                            setAttempt((v) => v + 1)
                        }}
                    >
                        Проверить снова
                    </button>
                ) : null}
                <Link to="/">Вернуться на сайт</Link>
            </div>
        </main>
    )
}
