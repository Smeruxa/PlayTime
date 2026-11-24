import type { Socket } from "socket.io-client"

export function subscribeProfileUpdates(socket: Socket, refresh: () => void, username?: string) {
    const onUpdated = (data?: { username?: string }) => {
        if (!username || !data?.username || data.username === username) refresh()
    }
    socket.on("profile:updated", onUpdated)
    socket.on("connect", refresh)
    window.addEventListener("playtime:refresh-friend-avatars", refresh)
    return () => {
        socket.off("profile:updated", onUpdated)
        socket.off("connect", refresh)
        window.removeEventListener("playtime:refresh-friend-avatars", refresh)
    }
}
