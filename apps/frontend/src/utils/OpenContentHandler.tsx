import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { OPEN_CONTENT_EVENT, type NotificationTarget } from "../platform/notifications"

export default function OpenContentHandler() {
    const navigate = useNavigate()

    useEffect(() => {
        const handler = (
            _event: unknown,
            data: { name?: string; peerUserId?: number; isRoom?: boolean; roomId?: number; roomName?: string }
        ) => {
            if (data?.isRoom && typeof data.roomId === "number") {
                navigate("/content", {
                    state: {
                        openRoom: {
                            id: data.roomId,
                            name: typeof data.roomName === "string" && data.roomName ? data.roomName : "Комната"
                        }
                    }
                })
                return
            }
            if (data?.name && Number.isSafeInteger(data.peerUserId) && Number(data.peerUserId) > 0) {
                navigate("/content", { state: { name: data.name, peerUserId: data.peerUserId } })
            }
        }

        window.electronAPI?.on("open-content", handler)
        const browserHandler = (event: Event) => handler(null, (event as CustomEvent<NotificationTarget>).detail)
        window.addEventListener(OPEN_CONTENT_EVENT, browserHandler)
        return () => {
            window.electronAPI?.off("open-content", handler)
            window.removeEventListener(OPEN_CONTENT_EVENT, browserHandler)
        }
    }, [navigate])

    return null
}
