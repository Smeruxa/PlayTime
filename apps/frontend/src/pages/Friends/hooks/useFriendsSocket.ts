import { useCallback, useEffect, useRef, useState } from "react"
import { createArrayRefresh } from "../../../server/socket/arrayRefresh"
import type { Socket } from "socket.io-client"
import { friendPeerId, type FriendIdentity, type FriendItem } from "../types"

type UseFriendsSocketOptions = {
    onAfterRequestFeedback?: () => void
}

export function useFriendsSocket(
    socket: Socket | null,
    options?: UseFriendsSocketOptions,
    myUserId: number | null = null
) {
    const onAfterRequestFeedbackRef = useRef(options?.onAfterRequestFeedback)
    onAfterRequestFeedbackRef.current = options?.onAfterRequestFeedback
    const [friends, setFriends] = useState<FriendItem[]>([])
    const [incomingRequests, setIncomingRequests] = useState<FriendItem[]>([])
    const [outgoingRequests, setOutgoingRequests] = useState<FriendIdentity[]>([])
    const [message, setMessage] = useState("")
    const [messageType, setMessageType] = useState(0)

    useEffect(() => {
        setFriends([])
        setIncomingRequests([])
        setOutgoingRequests([])
        if (!socket) return
        const friendsRefresh = createArrayRefresh<FriendItem>(
            (callback) => socket.emit("friend:list", null, callback),
            (list) => {
                const identities = list
                    .filter((friend) => friend && typeof friend.friend_username === "string")
                    .map((friend) => ({ ...friend, other_user_id: friendPeerId(friend, myUserId) ?? undefined }))
                    .filter((friend) => friend.other_user_id != null)
                setFriends(identities.filter((friend) => friend.status === "accepted" && !friend.is_room))
                setIncomingRequests(
                    identities.filter((friend) => friend.status === "pending" && friend.direction === "incoming")
                )
            }
        )
        const outgoingRefresh = createArrayRefresh<FriendIdentity>(
            (callback) => socket.emit("friend:outgoingIdentities", null, callback),
            (list) => {
                setOutgoingRequests(
                    list.filter(
                        (peer) =>
                            peer &&
                            Number.isSafeInteger(peer.userId) &&
                            peer.userId > 0 &&
                            typeof peer.username === "string"
                    )
                )
            }
        )
        const loadFriends = () => friendsRefresh.refresh()
        const loadOutgoingList = () => outgoingRefresh.refresh()
        const onOutgoingListError = loadOutgoingList

        const onRequest = () => {
            loadFriends()
            loadOutgoingList()
        }
        const onAccept = onRequest
        const onDecline = onRequest
        const onBlock = onRequest

        const onRequestSuccess = (data: { msg: string; username: string }) => {
            setMessageType(0)
            setMessage(data.msg)
            loadOutgoingList()
            onAfterRequestFeedbackRef.current?.()
        }

        const onRequestError = (data: { err: string }) => {
            setMessageType(1)
            setMessage(data.err)
            onAfterRequestFeedbackRef.current?.()
        }

        const onFriendListUpdated = () => {
            loadFriends()
            loadOutgoingList()
        }

        socket.on("friend:outgoingList:error", onOutgoingListError)
        socket.on("friend:request", onRequest)
        socket.on("friend:accept", onAccept)
        socket.on("friend:decline", onDecline)
        socket.on("friend:block", onBlock)
        socket.on("friend:request:success", onRequestSuccess)
        socket.on("friend:request:error", onRequestError)
        socket.on("friend:list:updated", onFriendListUpdated)

        friendsRefresh.refresh(true)
        outgoingRefresh.refresh(true)

        return () => {
            friendsRefresh.dispose()
            outgoingRefresh.dispose()
            socket.off("friend:outgoingList:error", onOutgoingListError)
            socket.off("friend:request", onRequest)
            socket.off("friend:request:error", onRequestError)
            socket.off("friend:request:success", onRequestSuccess)
            socket.off("friend:accept", onAccept)
            socket.off("friend:decline", onDecline)
            socket.off("friend:block", onBlock)
            socket.off("friend:list:updated", onFriendListUpdated)
        }
    }, [socket, myUserId])

    const sendRequest = useCallback(
        (friendUsername: string) => {
            if (!socket || !friendUsername) return
            socket.emit("friend:request", { friendUsername })
        },
        [socket]
    )

    const actOnFriend = useCallback(
        (event: string, friend: FriendItem) => {
            const peerUserId = friendPeerId(friend, myUserId)
            if (!socket || peerUserId == null) return
            socket.emit(event, { peerUserId })
        },
        [socket, myUserId]
    )
    const acceptRequest = useCallback((friend: FriendItem) => actOnFriend("friend:accept", friend), [actOnFriend])
    const declineRequest = useCallback((friend: FriendItem) => actOnFriend("friend:decline", friend), [actOnFriend])
    const blockRequest = useCallback((friend: FriendItem) => actOnFriend("friend:block", friend), [actOnFriend])
    const removeFriend = useCallback((friend: FriendItem) => actOnFriend("friend:remove", friend), [actOnFriend])
    const declineOutgoingRequest = useCallback(
        (friend: FriendIdentity) => {
            if (socket) socket.emit("friend:decline", { peerUserId: friend.userId })
        },
        [socket]
    )

    return {
        friends,
        incomingRequests,
        outgoingRequests,
        message,
        messageType,
        sendRequest,
        acceptRequest,
        declineRequest,
        declineOutgoingRequest,
        blockRequest,
        removeFriend
    }
}
