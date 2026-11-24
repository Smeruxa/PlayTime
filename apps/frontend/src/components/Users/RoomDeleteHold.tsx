import { useSessionSocket } from "../../server/socketContext"
import { HoldDeleteButton } from "../HoldDeleteButton/HoldDeleteButton"

type Props = {
    roomId: number
    onDeleted?: () => void
}

export function RoomDeleteHold({ roomId, onDeleted }: Props) {
    const { socket } = useSessionSocket()

    return (
        <HoldDeleteButton
            disabled={!socket}
            idleLabel="Удалить"
            holdingLabel="Удерживайте…"
            ariaLabel="Удалить комнату: удерживайте 3 секунды"
            onHoldComplete={() => {
                if (!socket) return
                socket.emit("room:delete", { roomId }, (res: { success?: boolean; err?: string }) => {
                    if (res?.success) onDeleted?.()
                    else if (res?.err) console.warn("room:delete", res.err)
                })
            }}
        />
    )
}
