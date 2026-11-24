import styles from "./ModalWindow.module.css"
import { useEffect, useState } from "react"
import { useSessionSocket } from "../../server/socketContext"
import type { FriendsAvatarsMap } from "../../types/friendAvatar"
import type { CallIncomingType } from "../../utils/IncomingCallHandler"

interface ModalWindowProps {
    call: CallIncomingType
    busy: boolean
    error: string | null
    onAnswer: (accept: boolean) => void
}

export default function ModalWindow({ call, busy, error, onAnswer }: ModalWindowProps) {
    const { socket } = useSessionSocket()
    const [callerAvatar, setCallerAvatar] = useState<string | null>(null)
    const name = call.from.trim()
    const parts = name.split(/\s+/)
    const initials = (parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2) || "?").toUpperCase()

    useEffect(() => {
        if (!socket) return
        let cancelled = false
        setCallerAvatar(null)
        socket.emit("profile:friendsAvatars", {}, (m: FriendsAvatarsMap | undefined) => {
            if (!cancelled) setCallerAvatar(m?.[call.from]?.avatar ?? null)
        })
        return () => {
            cancelled = true
        }
    }, [call.from, socket])

    return (
        <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="incoming-call-title">
            <div className={styles.card}>
                <div className={styles.badge}>
                    <span className={styles.badgeDot} aria-hidden />
                    <span id="incoming-call-title">Входящий звонок</span>
                </div>
                <div className={styles.avatarBlock}>
                    <div className={styles.avatarRing}>
                        <div className={styles.avatarInner}>
                            {callerAvatar ? (
                                <img
                                    src={callerAvatar}
                                    alt=""
                                    className={styles.avatarImg}
                                    onError={() => setCallerAvatar(null)}
                                />
                            ) : (
                                <span className={styles.avatarFallback}>{initials}</span>
                            )}
                        </div>
                    </div>
                </div>
                <p className={styles.name}>{call.from}</p>
                <p className={styles.subtitle}>Ответьте, чтобы подключиться к аудиозвонку, или отклоните вызов.</p>
                {error ? (
                    <p role="alert" className={styles.subtitle}>
                        {error}
                    </p>
                ) : null}
                <div className={styles.actions}>
                    <button
                        type="button"
                        className={`${styles.btn} ${styles.btnAccept}`}
                        disabled={busy}
                        onClick={() => onAnswer(true)}
                    >
                        Принять
                    </button>
                    <button
                        type="button"
                        className={`${styles.btn} ${styles.btnReject}`}
                        disabled={busy}
                        onClick={() => onAnswer(false)}
                    >
                        Отклонить
                    </button>
                </div>
            </div>
        </div>
    )
}
