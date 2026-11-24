import type { FeatureContext } from "../../../shared/socket/featureContext"
import type { CallClaimPayload, CallRoomIdPayload, CallStateWire } from "../../../shared/types/contracts/directCall"
import { socketAck } from "../../../shared/types/socket/ack"
import type { createCallLifecycle } from "./lifecycle"
import { attachLegacyOwner, callActor, mediaActor } from "./ownership"
import { callStore } from "./redisService"
import { isOptionalCallRevision } from "./revision"
import type { DirectCallServices } from "./services"
import type { createCallState } from "./state"

export function registerCallControl(
    { io, socket, user }: FeatureContext,
    { peerEventRoom }: Pick<DirectCallServices, "peerEventRoom">,
    { load, publish }: ReturnType<typeof createCallState>,
    { scheduleExpiry }: Pick<ReturnType<typeof createCallLifecycle>, "scheduleExpiry">
): void {
    const uid = user.id

    socket.on("call:current", async (callback: unknown) => {
        const ack = socketAck<{ state: CallStateWire | null } | { err: string }>(callback)
        if (!ack) return
        try {
            await socket.data.callEndpointReady
            const current = await callStore.current(uid)
            if (current.roomId) await attachLegacyOwner(socket, uid, current.roomId)
            if (current.roomId) await callStore.ownership(current.roomId, uid, "attach", mediaActor(socket, uid))
            const snapshot = current.roomId && current.room ? await load(current.roomId, current.room) : null
            const state = snapshot?.state ?? null
            if (
                state &&
                socket.handshake.auth.peerIdentityProtocol !== 1 &&
                (await peerEventRoom(uid, [state.caller.id, state.receiver.id])) !== String(uid)
            )
                return ack({ state: null })
            if (snapshot) scheduleExpiry(snapshot.state.roomId, snapshot.room)
            ack({ state })
        } catch {
            ack({ err: "Не удалось проверить звонок" })
        }
    })
    socket.on("call:claim", async (data: CallClaimPayload, callback: unknown) => {
        const ack = socketAck<{ state?: CallStateWire; err?: string }>(callback)
        if (!ack) return
        if (typeof data?.roomId !== "string" || !Number.isSafeInteger(data.expectedOwnershipRevision))
            return ack({ err: "Некорректная ревизия звонка" })
        try {
            await socket.data.callEndpointReady
            const result = await callStore.ownership(
                data.roomId,
                uid,
                "claim",
                callActor(socket, uid),
                data.expectedOwnershipRevision
            )
            if (result.kind !== "claimed" && result.kind !== "existing")
                return ack({
                    err: result.kind === "stale" ? "Звонок изменился. Повторите перенос" : "Перенос звонка недоступен"
                })
            const room = result.room
            if (!room) return ack({ err: "Звонок завершён" })
            if (result.previousOwner) {
                const owner = room.owners?.[String(uid)]
                const peerId = room.beginer_id === uid ? room.receiver_id : room.beginer_id
                const peer = room.owners?.[String(peerId)]
                if (!owner || !peer) throw new Error("Call ownership is incomplete")
                const ownershipRevision = owner.ownershipRevision
                io.to(result.previousOwner.socketId).emit("call:ownershipLost", {
                    roomId: data.roomId,
                    ownershipRevision
                })
                io.to(peer.socketId).emit("webrtc:peer:replaced", {
                    context: "direct",
                    roomId: data.roomId,
                    userId: uid,
                    ownershipRevision
                })
            }
            const snapshot = await publish(data.roomId, room)
            ack(snapshot ? { state: snapshot.state } : { err: "Звонок завершён" })
        } catch (error) {
            console.error("call:claim", error)
            ack({ err: "Не удалось перенести звонок" })
        }
    })
    socket.on("call:heartbeat", async (data: CallRoomIdPayload) => {
        if (typeof data?.roomId !== "string" || !isOptionalCallRevision(data.ownershipRevision)) return
        try {
            await socket.data.callEndpointReady
            const current = await callStore.ownership(
                data.roomId,
                uid,
                "heartbeat",
                mediaActor(socket, uid),
                data.ownershipRevision
            )
            if (current.kind === "missing") socket.emit("call:ended", { roomId: data.roomId })
            else if (current.kind === "forbidden") {
                const snapshot = await load(data.roomId)
                if (snapshot) socket.emit("call:state", snapshot.state)
            }
        } catch (error) {
            console.error("call:heartbeat", error)
        }
    })
}
