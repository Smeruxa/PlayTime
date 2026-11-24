import { redis } from "../../../shared/redis"
import type { FeatureContext, FeatureIo } from "../../../shared/socket/featureContext"
import { type CallActor, type CallRoomJson, CALL_RING_MS } from "./callStore"
import { expectCallInstance, sameCallInstance } from "./instance"
import { createCallLifecycle } from "./lifecycle"
import { mediaActor } from "./ownership"
import { CALL_RECONNECT_TIMEOUT_MS } from "./recovery"
import { callStore } from "./redisService"

const deadlines = "call:disconnect-deadlines"

type PendingDisconnect = {
    roomId: string
    room: CallRoomJson
    userId: number
    socketId: string
    owner?: CallActor
}

export async function rememberCallDisconnect({ user, socket }: FeatureContext): Promise<void> {
    const disconnectedAt = Date.now()
    const { roomId, room } = await callStore.current(user.id)
    if (!room || !roomId) return

    const actor = mediaActor(socket, user.id)
    const owner = room.owners?.[user.id]
    if (room.owners && (owner?.socketId !== actor.socketId || owner.endpointKey !== actor.endpointKey)) return
    if (!room.owners && (actor.modern || (room.expires_at ?? 0) - CALL_RING_MS > disconnectedAt ||
        (room.expires_at === undefined && (room.confirmed_at ?? 0) > disconnectedAt))) return

    const pending: PendingDisconnect = {
        roomId,
        room,
        userId: user.id,
        socketId: socket.id,
        owner: owner && { ...actor, ownershipRevision: owner.ownershipRevision, requireOfflineSocket: true }
    }
    await redis.zadd(deadlines, "NX", disconnectedAt + CALL_RECONNECT_TIMEOUT_MS, JSON.stringify(pending))
}

async function finishCallDisconnect(pending: PendingDisconnect, io: FeatureIo): Promise<CallRoomJson | undefined> {
    const { roomId, room, owner, userId, socketId } = pending
    if ((await io.in(owner ? socketId : String(userId)).fetchSockets()).length) return

    const current = await callStore.get(roomId)
    if (!current || !sameCallInstance(current, room)) return
    if (!owner && (current.owners || current.expires_at !== room.expires_at ||
        (room.confirmed_at !== undefined && current.confirmed_at !== room.confirmed_at))) return

    const instance = expectCallInstance(room)
    const result = await callStore.transition(roomId, userId, "end", owner
        ? { ...owner, ...instance }
        : { internal: true, ...instance })
    if (result.kind === "ended") return result.room
}

export function startCallDisconnectWorker(io: FeatureIo, hasGatewayLinks: () => boolean): () => void {
    const { notifyEnded } = createCallLifecycle(io, undefined)
    let working = false
    const tick = async () => {
        if (working || !hasGatewayLinks()) return
        working = true
        try {
            const entries = await redis.zrangebyscore(deadlines, "-inf", Date.now(), "LIMIT", 0, 32)
            for (const value of entries) {
                if (!hasGatewayLinks()) return
                const pending = JSON.parse(value) as PendingDisconnect
                const ended = await finishCallDisconnect(pending, io)
                if (ended) await notifyEnded(pending.roomId, ended)
                await redis.zrem(deadlines, value)
            }
        } catch (error) {
            console.error("Disconnected call cleanup temporarily unavailable", error)
        } finally {
            working = false
        }
    }
    const timer = setInterval(() => void tick(), 1000).unref()
    return () => clearInterval(timer)
}
