export type FriendItem = {
    id: number
    user_id: number
    friend_id: number
    other_user_id?: number
    status: "pending" | "accepted" | "blocked"
    friend_username: string
    friend_archived?: boolean
    direction?: "incoming" | "outgoing"
    is_room: boolean
}

export type FriendIdentity = { userId: number; username: string; archived?: boolean }

export function friendPeerId(friend: FriendItem, myUserId?: number | null): number | null {
    if (Number.isSafeInteger(friend.other_user_id) && Number(friend.other_user_id) > 0)
        return Number(friend.other_user_id)
    if (myUserId == null) return null
    const id = friend.user_id === myUserId ? friend.friend_id : friend.friend_id === myUserId ? friend.user_id : null
    return id != null && Number.isSafeInteger(id) && id > 0 ? id : null
}
