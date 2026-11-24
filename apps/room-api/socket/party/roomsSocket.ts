import type { RoomVoiceLimits } from "../../../shared/types/contracts/partyRoom"
import type { FeatureContext } from "../../../shared/socket/featureContext"
import { socketAck } from "../../../shared/types/socket/ack"
import { partyParticipantFromFetched, type PartyParticipantRef } from "../../../shared/socket/remoteParticipant"
import { parseRoomIdField } from "../../../shared/socket/parseRoomId"
import { getIceServers } from "../../media/iceServers"
import { withVoiceRoomLock } from "./voiceRoomLock"
import { isInParty, partyDepartures, PARTY_RECONNECT_GRACE_MS, PARTY_SOCKET_ROOM_PREFIX } from "./departures"

export type PartyRoomServices = {
    isMember: (roomId: number, userId: number) => Promise<boolean>
    limits: (roomId: number) => Promise<RoomVoiceLimits | null>
}

export interface RoomEnterPayload {
    roomId?: unknown
}

export interface RoomLeavePayload {
    roomId?: unknown
}

export interface RoomEnterAck {
    err?: string
    success?: true
}

export default function registerPartyRoomsSocket(
    { io, socket, user }: FeatureContext,
    services: PartyRoomServices,
    deferTransportLeaves = false
): void {
    const uid = user.id

    socket.on("room:enter", async (data: RoomEnterPayload, callback: unknown) => {
        const ack = socketAck<RoomEnterAck>(callback)
        try {
            const roomId = parseRoomIdField(data?.roomId)
            if (!roomId) return ack?.({ err: "Invalid room" })
            if (!(await services.isMember(roomId, uid))) return ack?.({ err: "Not a member" })
            return await withVoiceRoomLock(roomId, async (renew) => {
                const roomName = PARTY_SOCKET_ROOM_PREFIX + roomId
                const limits = await services.limits(roomId)
                if (!limits) return ack?.({ err: "Комната не найдена" })
                const socketsBefore = await io.in(roomName).fetchSockets()
                if (!socket.rooms.has(roomName) && socketsBefore.length >= limits.maxPartySockets) {
                    return ack?.({
                        err: `Достигнут лимит участников в голосе по тарифу владельца комнаты (одновременно не больше ${limits.maxPartySockets}).`
                    })
                }
                await renew()
                await socket.join(roomName)
                let member: boolean
                try {
                    member = await services.isMember(roomId, uid)
                } catch (error) {
                    await socket.leave(roomName)
                    throw error
                }
                if (!member) {
                    await socket.leave(roomName)
                    return ack?.({ err: "Not a member" })
                }
                if (deferTransportLeaves) await partyDepartures.remove({ roomId, userId: uid })
                const sockets = await io.in(roomName).fetchSockets()
                const participants: PartyParticipantRef[] = sockets
                    .map((s) => partyParticipantFromFetched(s))
                    .filter((p): p is PartyParticipantRef => p != null)
                socket.emit("webrtc:config", { iceServers: getIceServers(uid) })
                socket.emit("party:participants:list", participants)
                socket.to(roomName).emit("party:participant:joined", { userId: uid, username: user.username })
                ack?.({ success: true })
            })
        } catch (err) {
            console.error("room:enter", err)
            ack?.({ err: "Server error" })
        }
    })

    socket.on("room:leave", async (data: RoomLeavePayload) => {
        try {
            const roomId = parseRoomIdField(data?.roomId)
            if (!roomId) return
            if (!(await services.isMember(roomId, uid))) return
            const roomName = PARTY_SOCKET_ROOM_PREFIX + roomId
            if (!socket.rooms.has(roomName)) return
            const departure = { userId: uid, username: user.username }
            if (deferTransportLeaves) {
                await withVoiceRoomLock(roomId, async (renew) => {
                    if (!socket.rooms.has(roomName)) return
                    await socket.leave(roomName)
                    const online = await isInParty(io, roomName, uid)
                    await renew()
                    await partyDepartures.remove({ roomId, userId: uid })
                    if (!online) io.to(roomName).emit("party:participant:left", departure)
                })
            } else {
                io.to(roomName).emit("party:participant:left", departure)
                await socket.leave(roomName)
            }
        } catch (err) {
            console.error("room:leave", err)
        }
    })

    socket.on("disconnecting", async () => {
        const rooms = [...socket.rooms].filter((name) => name.startsWith(PARTY_SOCKET_ROOM_PREFIX))
        if (!deferTransportLeaves) {
            for (const roomName of rooms) io.to(roomName).emit("party:participant:left", { userId: uid, username: user.username })
            return
        }
        const due = Date.now() + PARTY_RECONNECT_GRACE_MS
        await Promise.all(rooms.map((roomName) => {
            const roomId = parseRoomIdField(roomName.slice(PARTY_SOCKET_ROOM_PREFIX.length))
            if (roomId) return partyDepartures.remember({ roomId, userId: uid }, user.username, due)
        }))
    })
}
