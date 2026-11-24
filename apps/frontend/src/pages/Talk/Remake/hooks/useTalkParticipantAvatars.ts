import { useEffect, useMemo, useState } from "react"
import type { Socket } from "socket.io-client"
import type { FriendsAvatarsMap } from "../../../../types/friendAvatar"
import { subscribeProfileUpdates } from "../../../../profile/profileUpdates"

export function useTalkParticipantAvatars(socket: Socket | null, fromParent?: FriendsAvatarsMap) {
    const [fetched, setFetched] = useState<FriendsAvatarsMap>({})
    const [avatarsReady, setAvatarsReady] = useState(false)

    useEffect(() => {
        if (!socket) {
            setAvatarsReady(true)
            return
        }
        setAvatarsReady(false)
        let cancelled = false
        const refresh = () =>
            socket.emit("profile:friendsAvatars", {}, (m: FriendsAvatarsMap | undefined) => {
                if (cancelled) return
                if (m && typeof m === "object") setFetched(m)
                setAvatarsReady(true)
            })
        const unsubscribe = subscribeProfileUpdates(socket, refresh)
        refresh()
        return () => {
            cancelled = true
            unsubscribe()
        }
    }, [socket])

    const avatarMap = useMemo(() => ({ ...fetched, ...(fromParent ?? {}) }), [fetched, fromParent])

    return { avatarMap, avatarsReady }
}
