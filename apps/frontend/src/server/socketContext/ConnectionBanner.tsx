import { useEffect, useState } from "react"
import type { Socket } from "socket.io-client"
import styles from "./ConnectionBanner.module.css"

export function ConnectionBanner({ socket, authenticated }: { socket: Socket | null; authenticated: boolean }) {
    const [offline, setOffline] = useState(false)
    useEffect(() => {
        if (!socket || !authenticated) {
            setOffline(false)
            return
        }
        const timer = setTimeout(() => setOffline(!socket.connected), 2000)
        const connected = () => setOffline(false),
            disconnected = () => setOffline(true)
        socket.on("connect", connected)
        socket.on("disconnect", disconnected)
        return () => {
            clearTimeout(timer)
            socket.off("connect", connected)
            socket.off("disconnect", disconnected)
        }
    }, [socket, authenticated])
    return authenticated && offline ? (
        <div className={styles.banner} role="status" aria-live="polite">
            Соединение потеряно. Переподключаемся… Текст останется в поле ввода до подтверждения отправки.
        </div>
    ) : null
}
