import type { FeatureIo } from "../../../shared/socket/featureContext"
import { CALL_RING_MS, type CallRoomJson } from "./callStore"
import { expectCallInstance } from "./instance"
import { callStore } from "./redisService"
import { clearCallRingTimeout, scheduleCallRingTimeout } from "./ringTimeout"
import type { DirectCallServices } from "./services"

export function createCallLifecycle(io: FeatureIo, logEnded: DirectCallServices["logEnded"]) {
    async function notifyEnded(roomId: string, room: CallRoomJson, event = "call:ended"): Promise<void> {
        clearCallRingTimeout(roomId, room)
        io.to(String(room.beginer_id)).emit(event, { roomId })
        io.to(String(room.receiver_id)).emit("call:ended", { roomId })
        void logEnded?.(io, room).catch((error) => console.error("call:log", error))
    }

    async function endCall(roomId: string, room: CallRoomJson): Promise<void> {
        const result = await callStore.transition(roomId, room.beginer_id, "end", {
            internal: true,
            ...expectCallInstance(room)
        })
        if (result.kind === "ended" && result.room) await notifyEnded(roomId, result.room)
    }

    async function notifyExpired(roomId: string, room: CallRoomJson): Promise<void> {
        await notifyEnded(roomId, room)
        const owner = room.owners?.[String(room.beginer_id)]
        io.to(owner?.socketId ?? String(room.beginer_id)).emit("call:noAnswer", {
            roomId,
            ownershipRevision: owner?.ownershipRevision
        })
    }

    function scheduleExpiry(roomId: string, room: CallRoomJson): void {
        if (room.status !== "request_receiver") return
        const delay = room.expires_at === undefined ? CALL_RING_MS : Math.max(0, room.expires_at - Date.now())
        scheduleCallRingTimeout(
            roomId,
            room,
            async () => {
                try {
                    const result = await callStore.transition(roomId, room.beginer_id, "expire", {
                        internal: true,
                        ...expectCallInstance(room)
                    })
                    if (result.kind === "ended" && result.room) await notifyExpired(roomId, result.room)
                } catch (error) {
                    console.error("call:ring timeout", error)
                }
            },
            delay
        )
    }

    return { notifyEnded, notifyExpired, endCall, scheduleExpiry }
}
