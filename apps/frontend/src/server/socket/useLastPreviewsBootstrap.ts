import { useEffect } from "react"
import type { Socket } from "socket.io-client"
import type { LastPreview } from "./types"
import { lastPreviewsFromWire, roomUnreadFromWire, dmUnreadFromWire, type LastPreviewsWire } from "./preview"

export function useLastPreviewsBootstrap(
    socket: Socket | null,
    myName: string | null,
    myUserId: number | null,
    setLastPreviews: React.Dispatch<React.SetStateAction<Record<string, LastPreview>>>,
    setRoomUnreadById: React.Dispatch<React.SetStateAction<Record<number, number>>>,
    setDmUnreadByUsername: React.Dispatch<React.SetStateAction<Record<string, number>>>
) {
    useEffect(() => {
        if (!socket || !myName || myUserId == null) return
        socket.emit("message:lastPreviews", (data: LastPreviewsWire) => {
            if (!data || typeof data !== "object" || "err" in data) return
            setLastPreviews(lastPreviewsFromWire(data, myName, myUserId))
            setRoomUnreadById(roomUnreadFromWire(data))
            setDmUnreadByUsername(dmUnreadFromWire(data))
        })
    }, [socket, myName, myUserId, setLastPreviews, setRoomUnreadById, setDmUnreadByUsername])
}
