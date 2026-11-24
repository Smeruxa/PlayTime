import { useEffect, useRef, useState } from "react"
import type { Socket } from "socket.io-client"
import type { DirectCallState } from "../../../utils/directCallState"
import { Button } from "../../../ui/primitives/Button"
import styles from "./CallOnAnotherDevice.module.css"

type Props = {
    call: DirectCallState
    userId: number
    socket: Socket
    onClaimed: (state: DirectCallState) => void
    onRefresh: () => void
}

export function CallOnAnotherDevice({ call, userId, socket, onClaimed, onRefresh }: Props) {
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")
    const current = useRef(call)
    current.current = call
    const mounted = useRef(true)
    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
        }
    }, [])
    const peer = call.caller.id === userId ? call.receiver : call.caller
    const claim = () => {
        if (busy || !call.media?.canClaim) return
        const expected = call.media.ownershipRevision
        const roomId = call.roomId
        setBusy(true)
        setError("")
        socket
            .timeout(8000)
            .emit(
                "call:claim",
                { roomId, expectedOwnershipRevision: expected },
                (failure: Error | null, response?: { state?: DirectCallState; err?: string }) => {
                    if (!mounted.current || current.current.roomId !== roomId) return
                    setBusy(false)
                    if (failure || response?.err || !response?.state?.media?.active) {
                        setError(response?.err || "Не удалось перенести звонок. Проверьте подключение и повторите.")
                        onRefresh()
                        return
                    }
                    onClaimed(response.state)
                }
            )
    }
    return (
        <section className={styles.card} role="status" aria-label="Звонок на другом устройстве">
            <strong>Звонок на другом устройстве</strong>
            <p>Вы общаетесь с {peer.username}. Можно продолжить этот звонок здесь.</p>
            {!call.media?.canClaim && (
                <p>
                    {call.status === "request_receiver"
                        ? "Дождитесь ответа собеседника, чтобы перенести звонок."
                        : "Для переноса обновите PlayTime на устройствах участников звонка."}
                </p>
            )}
            {error && <p role="alert">{error}</p>}
            <Button disabled={busy || !call.media?.canClaim} onClick={claim}>
                {busy ? "Переносим звонок…" : "Продолжить звонок здесь"}
            </Button>
        </section>
    )
}
