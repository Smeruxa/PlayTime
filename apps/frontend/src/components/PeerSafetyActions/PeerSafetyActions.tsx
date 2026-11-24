import { useEffect, useRef, useState } from "react"
import { API_BASE } from "../../config"
import { useSessionSocket } from "../../server/socketContext"
import { Button } from "../../ui"
import styles from "./PeerSafetyActions.module.css"

type SafetyState = { key: string; blocked: boolean; reporting: boolean; reason: string; busy: boolean; message: string }
const emptyState = (key: string): SafetyState => ({
    key,
    blocked: false,
    reporting: false,
    reason: "",
    busy: false,
    message: ""
})

export function PeerSafetyActions({ username, peerUserId }: { username: string; peerUserId?: number }) {
    const { token, myUserId } = useSessionSocket()
    const key = `${myUserId}:${peerUserId}:${token}`
    const currentKey = useRef(key)
    currentKey.current = key
    const request = useRef<AbortController | null>(null)
    const generation = useRef(0)
    const [state, setState] = useState(() => emptyState(key))
    const visible = state.key === key ? state : emptyState(key)
    const patch = (update: Partial<SafetyState>) =>
        setState((previous) => ({ ...(previous.key === key ? previous : emptyState(key)), ...update }))

    useEffect(() => {
        setState(emptyState(key))
        request.current?.abort()
        request.current = null
        if (!token || peerUserId == null || peerUserId === myUserId) return
        const controller = new AbortController()
        const lookupGeneration = ++generation.current
        void fetch(`${API_BASE}/peers/blocked`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal
        })
            .then((response) => {
                if (!response.ok) throw new Error()
                return response.json() as Promise<{ peers?: { user_id: number }[] }>
            })
            .then((body) => {
                if (
                    !controller.signal.aborted &&
                    currentKey.current === key &&
                    lookupGeneration === generation.current
                ) {
                    setState((previous) => ({
                        ...previous,
                        blocked: body.peers?.some((peer) => peer.user_id === peerUserId) === true
                    }))
                }
            })
            .catch(() => {})
        return () => {
            controller.abort()
            request.current?.abort()
        }
    }, [key, token, peerUserId, myUserId])

    if (!token || peerUserId == null || peerUserId === myUserId) return null
    const run = async (action: "block" | "unblock" | "report") => {
        if (visible.busy || request.current || currentKey.current !== key) return
        if (
            action === "block" &&
            !window.confirm(`Заблокировать ${username}? Личные сообщения, звонки и запросы в друзья будут остановлены.`)
        )
            return
        if (currentKey.current !== key) return
        const controller = new AbortController()
        request.current = controller
        generation.current += 1
        patch({ busy: true, message: "" })
        try {
            const response = await fetch(`${API_BASE}/peers/${encodeURIComponent(username)}/${action}`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ peerUserId, ...(action === "report" ? { reason: visible.reason } : {}) }),
                signal: controller.signal
            })
            const body = (await response.json()) as { error?: string }
            if (currentKey.current !== key || controller.signal.aborted) return
            if (!response.ok) throw new Error(body.error || "Не удалось выполнить действие")
            if (action === "report") patch({ reporting: false, reason: "", message: "Жалоба передана администратору." })
            else
                patch({
                    blocked: action === "block",
                    message:
                        action === "block"
                            ? "Пользователь заблокирован."
                            : "Блокировка снята. Для переписки добавьте друг друга в друзья снова."
                })
        } catch (error) {
            if (currentKey.current === key && !controller.signal.aborted)
                patch({ message: error instanceof Error ? error.message : "Нет соединения с сервером" })
        } finally {
            if (request.current === controller) request.current = null
            if (currentKey.current === key && !controller.signal.aborted) patch({ busy: false })
        }
    }
    return (
        <section className={styles.section} aria-label="Безопасность общения">
            <div className={styles.actions}>
                <Button
                    variant="ghost"
                    disabled={visible.busy}
                    onClick={() => void run(visible.blocked ? "unblock" : "block")}
                >
                    {visible.blocked ? "Разблокировать" : "Заблокировать"}
                </Button>
                <Button
                    variant="ghost"
                    disabled={visible.busy}
                    onClick={() => patch({ reporting: !visible.reporting })}
                >
                    Пожаловаться
                </Button>
            </div>
            {visible.reporting && (
                <form
                    className={styles.form}
                    onSubmit={(event) => {
                        event.preventDefault()
                        void run("report")
                    }}
                >
                    <label htmlFor={`report-reason-${peerUserId}`}>Причина жалобы</label>
                    <textarea
                        id={`report-reason-${peerUserId}`}
                        className={styles.reason}
                        value={visible.reason}
                        onChange={(event) => patch({ reason: event.target.value })}
                        minLength={5}
                        maxLength={1000}
                        required
                        disabled={visible.busy}
                    />
                    <p className={styles.hint}>
                        Администратор увидит описание и имена участников. Содержимое переписки автоматически не
                        передаётся.
                    </p>
                    <Button type="submit" disabled={visible.busy || visible.reason.trim().length < 5}>
                        Отправить жалобу
                    </Button>
                </form>
            )}
            {visible.message && (
                <p className={styles.hint} role="status">
                    {visible.message}
                </p>
            )}
        </section>
    )
}
