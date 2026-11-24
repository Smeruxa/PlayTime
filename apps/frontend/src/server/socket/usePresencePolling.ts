import { useEffect } from "react"
import { createArrayRefresh } from "./arrayRefresh"
import type { Socket } from "socket.io-client"

export function usePresencePolling(
    socket: Socket | null,
    setOnlineUserIds: React.Dispatch<React.SetStateAction<Set<number>>>
) {
    useEffect(() => {
        if (!socket) return
        const replace = (list: number[]) =>
            setOnlineUserIds((previous) => {
                const next = new Set(list)
                return previous.size === next.size && Array.from(next).every((name) => previous.has(name))
                    ? previous
                    : next
            })
        const refresh = createArrayRefresh<number>(
            (callback) => socket.emit("presence:listByUserId", callback),
            (list) => replace(list.filter((id) => Number.isSafeInteger(id) && id > 0))
        )
        const pull = () => {
            if (socket.connected) refresh.refresh()
        }
        const changed = ({ userId, online }: { userId: number; online: boolean }) =>
            setOnlineUserIds((previous) => {
                if (previous.has(userId) === online) return previous
                const next = new Set(previous)
                if (online) next.add(userId)
                else next.delete(userId)
                return next
            })
        const disconnected = () => replace([])
        if (socket.connected) refresh.refresh(true)
        const interval = setInterval(pull, 60_000)
        socket.on("connect", pull)
        socket.on("disconnect", disconnected)
        socket.on("presence:changed", changed)
        socket.on("friend:list:updated", pull)
        return () => {
            refresh.dispose()
            clearInterval(interval)
            socket.off("connect", pull)
            socket.off("disconnect", disconnected)
            socket.off("presence:changed", changed)
            socket.off("friend:list:updated", pull)
        }
    }, [socket, setOnlineUserIds])
}
