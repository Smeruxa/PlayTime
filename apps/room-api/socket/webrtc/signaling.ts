import { authorizeMedia } from "../directCall/ownership"
import { readSignalPayload } from "./signalPayload"
import type { FeatureContext } from "../../../shared/socket/featureContext"
import { getIceServers } from "../../media/iceServers"
import { getRoom } from "../directCall/redisService"
import { parseRoomIdField } from "../../../shared/socket/parseRoomId"
import { partyParticipantFromFetched } from "../../../shared/socket/remoteParticipant"
import type { WebrtcContext, WebrtcSignalPayload, WebrtcScreenStatePayload } from "../../../shared/types/contracts/webrtc"

const ROOM_SOCKET_PREFIX = "room:"

type PeerBlockCheck = (userId: number, peerId: number) => Promise<boolean>

function isDirectCallParticipant(room: { beginer_id: number; receiver_id: number }, userId: number): boolean {
    return userId === room.beginer_id || userId === room.receiver_id
}

function directCallPeerId(room: { beginer_id: number; receiver_id: number }, userId: number): number | null {
    if (userId === room.beginer_id) return room.receiver_id
    if (userId === room.receiver_id) return room.beginer_id
    return null
}

async function isUserInPartyRoom(io: FeatureContext["io"], roomId: number, targetUserId: number): Promise<boolean> {
    const roomName = ROOM_SOCKET_PREFIX + roomId
    const sockets = await io.in(roomName).fetchSockets()
    return sockets.some((s) => partyParticipantFromFetched(s)?.userId === targetUserId)
}

export default function registerWebrtcSignaling(
    { io, socket, user }: FeatureContext,
    isBlocked: PeerBlockCheck
): void {
    const uid = user.id

    socket.on("webrtc:config:request", () => {
        socket.emit("webrtc:config", { iceServers: getIceServers(uid) })
    })

    socket.on("webrtc:signal", async (data: WebrtcSignalPayload) => {
        try {
            const context = data?.context as WebrtcContext | undefined
            const type = data?.type
            const targetUserId = data?.targetUserId
            const roomId = data?.roomId

            if (!context || !type || !targetUserId || roomId == null) return
            if (typeof roomId !== "string" && typeof roomId !== "number") return
            if (typeof roomId === "string" && roomId.length > 128) return
            if (targetUserId === uid) return
            if (type !== "offer" && type !== "answer" && type !== "ice") return
            if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0) return
            const payload = readSignalPayload(type, data?.payload)
            if (!payload) return

            let destination = targetUserId.toString()
            let epochs = {}
            if (context === "direct") {
                const room = await getRoom(String(roomId))
                if (!room || !isDirectCallParticipant(room, uid)) return
                const peerId = directCallPeerId(room, uid)
                if (peerId == null || targetUserId !== peerId) return
                if (room.status !== "in_call") return
                if (await isBlocked(uid, peerId)) return
                const delivery = await authorizeMedia(socket, uid, String(roomId), data)
                if (!delivery) return
                destination = delivery.target
                epochs = delivery.epochs
            } else if (context === "party") {
                const partyRoomId = parseRoomIdField(roomId)
                if (!partyRoomId) return
                const roomName = ROOM_SOCKET_PREFIX + partyRoomId
                if (!socket.rooms.has(roomName)) return
                if (!(await isUserInPartyRoom(io, partyRoomId, targetUserId))) return
            } else {
                return
            }

            io.to(destination).emit("webrtc:signal", {
                ...epochs,
                roomId,
                context,
                type,
                fromUserId: uid,
                fromUsername: user.username,
                payload
            })
        } catch (err) {
            console.error("webrtc:signal", err)
        }
    })

    socket.on("webrtc:screen:state", async (data: WebrtcScreenStatePayload) => {
        try {
            const context = data?.context as WebrtcContext | undefined
            const roomId = data?.roomId
            const active = data?.active
            if (!context || roomId == null || typeof active !== "boolean") return

            const relay = (targetUserId: number, destination = String(targetUserId), epochs = {}) => {
                io.to(destination).emit("webrtc:screen:state", {
                    ...epochs,
                    roomId,
                    context,
                    fromUserId: uid,
                    fromUsername: user.username,
                    active
                })
            }

            if (context === "direct") {
                const room = await getRoom(String(roomId))
                if (!room || !isDirectCallParticipant(room, uid)) return
                if (room.status !== "in_call") return
                const peerId = directCallPeerId(room, uid)
                if (peerId != null && !(await isBlocked(uid, peerId))) {
                    const delivery = await authorizeMedia(socket, uid, String(roomId), data)
                    if (delivery) relay(peerId, delivery.target, delivery.epochs)
                }
            } else if (context === "party") {
                const partyRoomId = parseRoomIdField(roomId)
                if (!partyRoomId) return
                const roomName = ROOM_SOCKET_PREFIX + partyRoomId
                if (!socket.rooms.has(roomName)) return
                const sockets = await io.in(roomName).fetchSockets()
                for (const s of sockets) {
                    const p = partyParticipantFromFetched(s)
                    if (p && p.userId !== uid) relay(p.userId)
                }
            }
        } catch (err) {
            console.error("webrtc:screen:state", err)
        }
    })
}
