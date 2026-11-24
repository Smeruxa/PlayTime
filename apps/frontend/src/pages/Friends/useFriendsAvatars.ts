import { useState, useEffect } from "react"
import type { Socket } from "socket.io-client"
import type { FriendIdentity, FriendItem } from "./types"
import type { FriendsAvatarsMap } from "../../types/friendAvatar"
import { subscribeProfileUpdates } from "../../profile/profileUpdates"

export function useFriendsAvatars(
    socket: Socket | null,
    friends: FriendItem[],
    incomingRequests: FriendItem[],
    outgoingRequests: FriendIdentity[]
) {
    const [avatarByUsername, setAvatarByUsername] = useState<FriendsAvatarsMap>({})

    useEffect(() => {
        if (!socket) return
        let cancelled = false
        const refresh = () =>
            socket.emit("profile:friendsAvatars", { byUserId: true }, (m: FriendsAvatarsMap | undefined) => {
                if (!cancelled && m && typeof m === "object" && !Array.isArray(m) && !("err" in m))
                    setAvatarByUsername(m)
            })
        const unsubscribe = subscribeProfileUpdates(socket, refresh)
        refresh()
        return () => {
            cancelled = true
            unsubscribe()
        }
    }, [socket, friends, incomingRequests, outgoingRequests])

    const avatarFor = (userId: number) => avatarByUsername[userId]?.avatar ?? null
    const avatarEffectFor = (userId: number) => avatarByUsername[userId]?.profileAvatarEffect ?? "none"
    return { avatarByUsername, avatarFor, avatarEffectFor }
}
