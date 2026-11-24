import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useSessionSocket } from "../../server/socketContext"

export function useCreateRoom() {
    const navigate = useNavigate()
    const { socket } = useSessionSocket()
    const [name, setName] = useState("")
    const [error, setError] = useState<string | null>(null)

    const createParty = () => {
        const trimmed = name?.trim() || ""
        if (!socket || trimmed.length < 3) {
            setError("Введите название от 3 до 15 символов")
            return
        }
        setError(null)
        socket.emit(
            "room:create",
            { name: trimmed },
            (res: { success?: boolean; roomId?: number; name?: string; err?: string }) => {
                if (res?.success && res.roomId != null) {
                    navigate("/content", { state: { openRoom: { id: res.roomId, name: res.name || trimmed } } })
                } else {
                    setError(res?.err || "Ошибка создания комнаты")
                }
            }
        )
    }

    return { name, setName, error, createParty, navigate }
}
