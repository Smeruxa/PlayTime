import { useEffect } from "react"
import type { MutableRefObject } from "react"
import type { Socket } from "socket.io-client"
import { fetchFriendDmPublicKey } from "../../dmE2ee"

export function usePeerDmPublicKeyPoller(
    socket: Socket | null,
    is_room: boolean,
    name: string,
    peerPubRef: MutableRefObject<string | null>,
    peerUserId?: number
) {
    useEffect(() => {
        let cancelled = false
        peerPubRef.current = null
        if (!socket || is_room || !name || name === "Выберите пользователя") {
            return () => {
                cancelled = true
            }
        }
        const load = async () => {
            const pk = await fetchFriendDmPublicKey(socket, name, undefined, peerUserId)
            if (!cancelled) peerPubRef.current = pk
        }
        void load()
        const intervalId = window.setInterval(() => {
            void load()
        }, 4000)
        const onVisible = () => {
            if (document.visibilityState === "visible") void load()
        }
        const onFocus = () => {
            void load()
        }
        document.addEventListener("visibilitychange", onVisible)
        window.addEventListener("focus", onFocus)
        return () => {
            cancelled = true
            window.clearInterval(intervalId)
            document.removeEventListener("visibilitychange", onVisible)
            window.removeEventListener("focus", onFocus)
        }
    }, [socket, is_room, name, peerPubRef, peerUserId])
}
