import { useState, useEffect } from "react"
import { useSocket } from "../server/SocketContext"
import ModalWindow from "../components/ModalWindow/ModalWindow"

export type CallIncomingType = {
    from: string
    roomId: string
}

export default function IncomingCallHandler() {
    const [incomingCall, setIncomingCall] = useState<CallIncomingType | null>(null)
    const { socket } = useSocket()

    useEffect(() => {
        if (!socket) return

        const handleIncoming = (data: any) => setIncomingCall({ from: data.from, roomId: data.roomId })
        const handleEnded = () => setIncomingCall(null)

        socket.on("call:incomingCall", handleIncoming)
        socket.on("call:ended", handleEnded)

        return () => {
            socket.off("call:incoming", handleIncoming)
            socket.off("call:ended", handleEnded)
        }
    }, [socket])

    if (!incomingCall) return null

    return (
        <ModalWindow
            text="Входящий звонок..."
            call={incomingCall}
            setShow={setIncomingCall}
        />
    )
}