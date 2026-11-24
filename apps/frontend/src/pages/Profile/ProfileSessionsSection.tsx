import { useCallback, useEffect, useState } from "react"
import { API_BASE } from "../../config"
import { useSessionSocket } from "../../server/socketContext"
import { FiMonitor } from "react-icons/fi"
import { FaLaptop } from "react-icons/fa"
import { ProfileSessionRevokeModal, type SessionRevokeTarget } from "./ProfileSessionRevokeModal"
import styles from "./ProfileAccount.module.css"

type DeviceSession = { id: string; deviceName: string; createdAt: string; lastSeenAt: string; current: boolean }

export function ProfileSessionsSection() {
    const { token, logout } = useSessionSocket()
    const [sessions, setSessions] = useState<DeviceSession[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")
    const [target, setTarget] = useState<SessionRevokeTarget | null>(null)
    const [confirmationOpen, setConfirmationOpen] = useState(false)
    const load = useCallback(
        async (signal?: AbortSignal) => {
            if (!token) {
                setLoading(false)
                return
            }
            setLoading(true)
            try {
                const response = await fetch(`${API_BASE}/auth/sessions`, {
                    headers: { Authorization: `Bearer ${token}` },
                    signal
                })
                const body = await response.json()
                if (!response.ok) throw new Error(body.error || "Не удалось загрузить устройства")
                if (!signal?.aborted) {
                    setSessions(body.sessions)
                    setError("")
                }
            } catch (err) {
                if (!signal?.aborted) setError(err instanceof Error ? err.message : "Не удалось загрузить устройства")
            } finally {
                if (!signal?.aborted) setLoading(false)
            }
        },
        [token]
    )
    useEffect(() => {
        const controller = new AbortController()
        void load(controller.signal)
        return () => controller.abort()
    }, [load])
    const choose = (device: SessionRevokeTarget) => {
        setTarget(device)
        setConfirmationOpen(true)
    }
    const count = sessions.length
    const countLabel =
        count % 10 === 1 && count % 100 !== 11
            ? "сеанс"
            : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)
              ? "сеанса"
              : "сеансов"
    return (
        <>
            <section className={`${styles.card} ${styles.wide}`} aria-labelledby="account-devices-heading">
                <div className={styles.cardHeading}>
                    <h2 id="account-devices-heading" className={styles.title}>
                        Ваши устройства
                    </h2>
                    {!loading && !error ? (
                        <span className={styles.count}>
                            {count} {countLabel}
                        </span>
                    ) : null}
                </div>
                <div className={styles.devices}>
                    {sessions.map((device) => (
                        <div key={device.id} className={styles.device}>
                            <div className={styles.deviceIcon}>
                                {/mac|linux|laptop/i.test(device.deviceName) ? (
                                    <FaLaptop aria-hidden />
                                ) : (
                                    <FiMonitor aria-hidden />
                                )}
                            </div>
                            <div className={styles.deviceInfo}>
                                <div className={styles.deviceName}>
                                    {device.deviceName}
                                    {device.current ? <span className={styles.badge}>Текущее</span> : null}
                                </div>
                                <div className={styles.deviceDate}>
                                    Активность:{" "}
                                    {new Date(device.lastSeenAt).toLocaleString("ru-RU", {
                                        day: "numeric",
                                        month: "short",
                                        hour: "2-digit",
                                        minute: "2-digit"
                                    })}
                                </div>
                            </div>
                            {!device.current && (
                                <button
                                    type="button"
                                    className={`${styles.button} ${styles.link}`}
                                    disabled={loading}
                                    onClick={() => choose(device)}
                                >
                                    Завершить
                                </button>
                            )}
                        </div>
                    ))}
                </div>
                {loading && (
                    <p className={styles.hint} role="status">
                        Загрузка устройств…
                    </p>
                )}
                {!loading && !sessions.length && !error && <p className={styles.hint}>Активных устройств нет.</p>}
                {error && (
                    <p className={styles.error} role="alert">
                        {error}
                    </p>
                )}
                {sessions.filter((device) => !device.current).length > 1 ? (
                    <button
                        type="button"
                        className={`${styles.button} ${styles.link} ${styles.sessionFooter}`}
                        disabled={loading}
                        onClick={() => choose("others")}
                    >
                        Завершить остальные сеансы
                    </button>
                ) : null}
                {error && (
                    <button
                        type="button"
                        className={`${styles.button} ${styles.sessionFooter}`}
                        disabled={loading}
                        onClick={() => void load()}
                    >
                        Повторить
                    </button>
                )}
            </section>
            {target && token && (
                <ProfileSessionRevokeModal
                    key={target === "others" ? "others" : target.id}
                    open={confirmationOpen}
                    target={target}
                    token={token}
                    onClose={() => setConfirmationOpen(false)}
                    onConfirmed={async () => {
                        if (target !== "others" && target.current) logout()
                        else await load()
                        setConfirmationOpen(false)
                        setTarget(null)
                    }}
                />
            )}
        </>
    )
}
