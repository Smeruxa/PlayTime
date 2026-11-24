import { useEffect, type Dispatch, type SetStateAction, type RefObject } from "react"
import type { Socket } from "socket.io-client"
import type { MessageType } from "../../types"
import { isPeerNotifyMuted } from "../../notificationPrefs"
import { notifyMessage } from "../../platform/notifications"
import type { LastPreview } from "./types"
import {
    lastPreviewsFromWire,
    previewDecryptPlaintext,
    roomUnreadFromWire,
    dmUnreadFromWire,
    truncateMessagePreview,
    previewPlainToSidebarLabel,
    type LastPreviewsWire
} from "./preview"

type CurrentChat = { name: string; id: number; isRoom: boolean } | null

export function useMessagePreviewSideEffects(
    socket: Socket | null,
    myName: string | null,
    myUserId: number | null,
    currentChat: CurrentChat,
    setLastPreviews: Dispatch<SetStateAction<Record<string, LastPreview>>>,
    setRoomUnreadById: Dispatch<SetStateAction<Record<number, number>>>,
    setDmUnreadByUsername: Dispatch<SetStateAction<Record<string, number>>>,
    windowFocusedRef: RefObject<boolean>
) {
    useEffect(() => {
        if (!socket) return
        const messageReceiveHandler = (
            msg: MessageType & {
                sender_id?: number
                receiver_id?: number
                from?: string
                room?: boolean
                fromSelf?: boolean
                roomId?: number
                roomName?: string
            }
        ) => {
            const isRoom = !!msg.room
            const decryptedBody = isRoom
                ? typeof msg.roomId === "number"
                    ? previewDecryptPlaintext(msg.content, { kind: "room", roomId: msg.roomId })
                    : previewDecryptPlaintext(msg.content, { kind: "none" })
                : previewDecryptPlaintext(msg.content, {
                      kind: "dm",
                      myUserId,
                      myName,
                      fromUserId: msg.sender_id,
                      fromUsername: msg.sender_username ?? "",
                      is_dm_e2ee: msg.is_dm_e2ee,
                      senderDmPublicKey: msg.senderDmPublicKey,
                      receiverDmPublicKey: msg.receiverDmPublicKey
                  })
            const peerUserId = msg.sender_id === myUserId ? msg.receiver_id : msg.sender_id
            const previewKey = isRoom ? `room-${msg.roomId}` : peerUserId != null ? `dm-${peerUserId}` : null
            if (previewKey) {
                const from = isRoom ? (msg.from ?? "") : (msg.sender_username ?? "")
                setLastPreviews((prev) => ({
                    ...prev,
                    [previewKey]: {
                        from,
                        content: truncateMessagePreview(previewPlainToSidebarLabel(decryptedBody))
                    }
                }))
            }
            if (isRoom && typeof msg.roomId === "number" && !msg.fromSelf) {
                const inThisRoom = currentChat?.isRoom && currentChat.id === msg.roomId
                if (!inThisRoom) {
                    setRoomUnreadById((prev) => ({
                        ...prev,
                        [msg.roomId!]: (prev[msg.roomId!] ?? 0) + 1
                    }))
                }
            }
            if (
                !isRoom &&
                myUserId != null &&
                msg.receiver_id === myUserId &&
                msg.sender_id != null &&
                msg.sender_id !== myUserId
            ) {
                const inThisDm = currentChat && !currentChat.isRoom && currentChat.id === msg.sender_id
                if (!inThisDm) {
                    const from = String(msg.sender_id)
                    setDmUnreadByUsername((prev) => ({
                        ...prev,
                        [from]: (prev[from] ?? 0) + 1
                    }))
                }
            }
            if (msg.fromSelf) return
            if (!isRoom && msg.sender_id === myUserId) return
            const peerName = isRoom ? msg.from : msg.sender_username
            if (!isRoom && peerName && isPeerNotifyMuted(myUserId, msg.sender_id!)) return
            const chatOpen =
                !!currentChat &&
                ((currentChat.isRoom && msg.roomId === currentChat.id) ||
                    (!currentChat.isRoom && msg.sender_id === currentChat.id))
            if (chatOpen && windowFocusedRef.current) return
            if (peerName) {
                const title = isRoom ? msg.roomName || peerName : peerName
                notifyMessage({
                    name: title,
                    peerUserId: isRoom ? undefined : msg.sender_id,
                    text: previewPlainToSidebarLabel(decryptedBody),
                    isRoom,
                    roomId: isRoom ? msg.roomId : undefined,
                    roomName: isRoom ? msg.roomName : undefined
                })
            }
        }
        socket.on("message:receive", messageReceiveHandler)
        const sendSuccessHandler = (msg: {
            receiver_id?: number
            receiver_username?: string
            content?: string
            is_dm_e2ee?: boolean
            senderDmPublicKey?: string | null
            receiverDmPublicKey?: string | null
        }) => {
            if (msg.receiver_id != null && myName && msg.content != null) {
                const decrypted = previewDecryptPlaintext(msg.content, {
                    kind: "dm",
                    myUserId,
                    myName,
                    fromUserId: myUserId ?? undefined,
                    fromUsername: myName,
                    is_dm_e2ee: msg.is_dm_e2ee,
                    senderDmPublicKey: msg.senderDmPublicKey,
                    receiverDmPublicKey: msg.receiverDmPublicKey
                })
                setLastPreviews((prev) => ({
                    ...prev,
                    [`dm-${msg.receiver_id}`]: {
                        from: myName,
                        content: truncateMessagePreview(previewPlainToSidebarLabel(decrypted))
                    }
                }))
            }
        }
        socket.on("message:send:success", sendSuccessHandler)

        const refetchLastPreviews = () => {
            socket.emit("message:lastPreviews", (data: LastPreviewsWire) => {
                if (!data || typeof data !== "object" || "err" in data) return
                setLastPreviews(lastPreviewsFromWire(data, myName, myUserId))
                setRoomUnreadById(roomUnreadFromWire(data))
                setDmUnreadByUsername(dmUnreadFromWire(data))
            })
        }
        const handleDeleted = () => {
            refetchLastPreviews()
        }
        socket.on("message:deleted", handleDeleted)

        return () => {
            socket.off("message:receive", messageReceiveHandler)
            socket.off("message:send:success", sendSuccessHandler)
            socket.off("message:deleted", handleDeleted)
        }
    }, [
        socket,
        myName,
        myUserId,
        currentChat,
        setLastPreviews,
        setRoomUnreadById,
        setDmUnreadByUsername,
        windowFocusedRef
    ])
}
