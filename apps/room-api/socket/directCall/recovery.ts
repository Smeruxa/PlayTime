import { callActor, mediaActor, authorizeMedia } from "./ownership"
import { callStore } from "./redisService"
import type { FeatureContext } from "../../../shared/socket/featureContext"
import type { CallRoomJson } from "./redisService"
import type { CallResumeAck, CallRoomIdPayload } from "../../../shared/types/contracts/directCall"
import { socketAck } from "../../../shared/types/socket/ack"
import { CALL_RING_MS } from "./callStore"
import { expectCallInstance, sameCallInstance } from "./instance"

export const CALL_RECONNECT_TIMEOUT_MS = 60_000

const disconnectTimers = new Map<number, ReturnType<typeof setTimeout>>()

type RecoveryServices = {
    getRoom: (roomId: string) => Promise<CallRoomJson | null>
    getAllRooms: () => Promise<{ key: string; room: CallRoomJson }[]>
    getUserRoom?: (userId: number) => Promise<{ key: string; room: CallRoomJson } | null>
    roomPrefix: string
    durableDisconnects?: boolean
    notifyEnded?: (roomId: string, room: CallRoomJson) => Promise<void>
    endCall: (roomId: string, room: CallRoomJson) => Promise<void>
}

export function registerDirectCallRecovery({ io, socket, user }: FeatureContext, services: RecoveryServices): void {
    const uid = user.id
    const previous = disconnectTimers.get(uid)
    if (previous) clearTimeout(previous)
    disconnectTimers.delete(uid)

    socket.on("call:resume", async (data: CallRoomIdPayload, callback: unknown) => {
        const ack = socketAck<CallResumeAck>(callback)
        if (!ack) return
        try {
            const roomId = typeof data?.roomId === "string" ? data.roomId : ""
            const room = await services.getRoom(roomId)
            if (!room) return ack({ ended: true })
            if (room.beginer_id !== uid && room.receiver_id !== uid) {
                return ack({ err: "You are not part of this call" })
            }
            if (!(await authorizeMedia(socket, uid, roomId, data, false)))
                return ack({ err: "Звонок продолжается на другом устройстве" })
            ack({ success: true, status: room.status })
        } catch (err) {
            console.error("call:resume", err)
            ack({ err: "Server error" })
        }
    })

    if (services.durableDisconnects) return

    socket.on("disconnect", () => {
        const actor = mediaActor(socket, uid)
        {
            void (async () => {
                const { room, roomId } = await callStore.current(uid)
                if (!room || !roomId) return
                const owner = room.owners?.[String(uid)]
                if (!owner || owner.endpointKey !== actor.endpointKey || owner.socketId !== actor.socketId) return
                const timer = setTimeout(() => {
                    void (async () => {
                        const live = await io.in(actor.socketId).fetchSockets()
                        if (live.length) return
                        const result = await callStore.transition(roomId, uid, "end", {
                            ...actor,
                            ownershipRevision: owner.ownershipRevision,
                            ...expectCallInstance(room)
                        })
                        if (result.kind === "ended" && result.room) await services.notifyEnded?.(roomId, result.room)
                    })().catch((error) => console.error("call:owner disconnect timeout", error))
                }, CALL_RECONNECT_TIMEOUT_MS)
                timer.unref?.()
            })().catch((error) => console.error("call:owner disconnect", error))
        }
        if (callActor(socket, uid)) return
        const previous = disconnectTimers.get(uid)
        if (previous) clearTimeout(previous)
        const disconnectedAt = Date.now()
        const abandonedRooms = (async () => {
            const current = services.getUserRoom ? await services.getUserRoom(uid) : undefined
            const rooms = services.getUserRoom ? (current ? [current] : []) : await services.getAllRooms()
            return rooms
                .filter(({ room }) => {
                    if (room.owners) return false
                    if (room.beginer_id !== uid && room.receiver_id !== uid) return false
                    if (room.expires_at !== undefined && room.expires_at - CALL_RING_MS > disconnectedAt) return false
                    if (
                        room.expires_at === undefined &&
                        room.confirmed_at !== undefined &&
                        room.confirmed_at > disconnectedAt
                    )
                        return false
                    return true
                })
                .map(({ key, room }) => ({ key, room: { ...room } }))
        })().catch((err) => {
            console.error("call:disconnect snapshot", err)
            return []
        })
        const timer = setTimeout(() => {
            void (async () => {
                try {
                    const sockets = await io.in(uid.toString()).fetchSockets()
                    if (disconnectTimers.get(uid) !== timer) return
                    const rooms = await abandonedRooms
                    for (const { key, room: abandoned } of rooms) {
                        if (sockets.length) continue
                        const roomId = key.slice(services.roomPrefix.length)
                        const room = await services.getRoom(roomId)
                        if (disconnectTimers.get(uid) !== timer) return
                        if (
                            !room ||
                            room.beginer_id !== abandoned.beginer_id ||
                            room.receiver_id !== abandoned.receiver_id ||
                            !sameCallInstance(room, abandoned)
                        )
                            continue
                        if (room.expires_at !== abandoned.expires_at) continue
                        if (abandoned.confirmed_at !== undefined && room.confirmed_at !== abandoned.confirmed_at)
                            continue
                        await services.endCall(roomId, room)
                    }
                } catch (err) {
                    console.error("call:disconnect timeout", err)
                } finally {
                    if (disconnectTimers.get(uid) === timer) disconnectTimers.delete(uid)
                }
            })()
        }, CALL_RECONNECT_TIMEOUT_MS)
        disconnectTimers.set(uid, timer)
    })
}
