import { resolveAuthedUser, type FeatureContext } from "../../../shared/socket/featureContext"
import type {
    CallConfirmPayload,
    CallRoomIdPayload,
    CallStartAck,
    CallStartPayload,
    CallStateWire
} from "../../../shared/types/contracts/directCall"
import { socketAck } from "../../../shared/types/socket/ack"
import { sendCallIceServers } from "../../media/iceServers"
import { CALL_RING_MS } from "./callStore"
import { expectCallInstance, isCallParticipant } from "./instance"
import type { createCallLifecycle } from "./lifecycle"
import { callActor, mediaActor } from "./ownership"
import { callStore, getRoom } from "./redisService"
import { isOptionalCallRevision } from "./revision"
import { clearCallRingTimeout } from "./ringTimeout"
import type { DirectCallServices } from "./services"
import { emitCallConfirmed, type createCallState } from "./state"

export function registerCallCommands(
    { io, socket, user }: FeatureContext,
    services: Pick<DirectCallServices, "resolvePeer" | "peerEventRoom" | "canCall" | "enqueueIncomingCall">,
    { publish }: Pick<ReturnType<typeof createCallState>, "publish">,
    { endCall, notifyEnded, scheduleExpiry }: ReturnType<typeof createCallLifecycle>
): void {
    const uid = user.id

    socket.on("call:start", async (data: CallStartPayload, callback: unknown) => {
        const ack = socketAck<CallStartAck>(callback)
        if (!ack) return
        try {
            const peer = await services.resolvePeer(data?.peerUserId, data?.username)
            if (!peer) return ack({ err: "Пользователь не найден" })
            const receiverId = peer.id
            if (receiverId === uid) return ack({ err: "Нельзя позвонить самому себе" })
            const recipientRoom = await services.peerEventRoom(receiverId, [uid, receiverId])
            if (recipientRoom !== String(receiverId)) {
                if (socket.handshake.auth.peerIdentityProtocol !== 1)
                    return ack({ err: "Обновите приложение для звонка" })
                if (!(await io.in(recipientRoom).fetchSockets()).length)
                    return ack({ err: "Собеседнику нужно обновить приложение для звонка" })
            }
            if (!(await services.canCall(uid, receiverId))) return ack({ err: "Можно звонить только друзьям" })
            const devices = await io.in([uid.toString(), receiverId.toString()]).fetchSockets()
            const supportsUniqueRoomIds =
                devices.length > 0 &&
                devices.every(({ handshake: { auth } }) => auth.callProtocol === 2 || auth.callProtocol === 3)
            await socket.data.callEndpointReady
            const actor = callActor(socket, uid)
            const modernPeer = devices.some(
                (device) => resolveAuthedUser(device)?.id === receiverId && callActor(device, receiverId)
            )
            const ownershipActor = actor ?? mediaActor(socket, uid)
            const reserved = await callStore.reserve(
                uid,
                receiverId,
                supportsUniqueRoomIds,
                ownershipActor,
                !!(ownershipActor && modernPeer)
            )
            if (reserved.kind === "forbidden") return ack({ err: "Продолжите звонок на этом устройстве" })
            if (reserved.kind === "caller_busy") return ack({ err: "Вы уже в другом звонке" })
            if (reserved.kind === "callee_busy") return ack({ err: "Собеседник уже в звонке" })
            const { roomId, room } = reserved
            if (!roomId || !room) return ack({ err: "Звонок уже завершён" })
            let stillFriends: boolean
            try {
                stillFriends = await services.canCall(uid, receiverId)
            } catch (error) {
                if (reserved.kind === "created") await endCall(roomId, room)
                throw error
            }
            if (!stillFriends) {
                await endCall(roomId, room)
                return ack({ err: "Можно звонить только друзьям" })
            }
            sendCallIceServers(io, room.beginer_id, room.receiver_id)
            const snapshot = await publish(roomId, room)
            if (!snapshot) return ack({ err: "Звонок уже завершён" })
            const { state, room: current } = snapshot
            if (state.status === "in_call") {
                clearCallRingTimeout(roomId, current)
                emitCallConfirmed(io, roomId, current)
            } else {
                io.to(snapshot.receiverTarget).emit("call:incomingCall", {
                    from: user.username,
                    fromUserId: uid,
                    roomId,
                    expiresAt: state.expiresAt
                })
                void services
                    .enqueueIncomingCall({
                        roomId,
                        senderId: uid,
                        senderUsername: user.username,
                        recipientId: current.receiver_id,
                        expiresAt: state.expiresAt ?? Date.now() + CALL_RING_MS
                    })
                    .catch(() => console.error("Incoming call push could not be queued"))
                scheduleExpiry(roomId, current)
            }
            ack({ success: true, roomId, confirmed: state.status === "in_call", state })
        } catch (error) {
            console.error("call:start", error)
            ack({ err: "Не удалось начать звонок" })
        }
    })

    socket.on("call:confirm", async (data: CallConfirmPayload, callback: unknown) => {
        const ack = socketAck<{ success: true; state: CallStateWire | null } | { err: string }>(callback)
        try {
            if (typeof data?.roomId !== "string" || typeof data.accept !== "boolean")
                return ack?.({ err: "Некорректный звонок" })
            const { roomId, accept } = data
            await socket.data.callEndpointReady
            const actor = callActor(socket, uid)
            const result = await callStore.transition(
                roomId,
                uid,
                accept ? "accept" : "reject",
                actor ?? mediaActor(socket, uid)
            )
            if (result.kind === "forbidden" || !result.room) {
                const err =
                    result.kind === "forbidden" ? "Только получатель может ответить на звонок" : "Звонок уже завершён"
                ack?.({ err })
                socket.emit("call:confirm:error", { roomId, err })
                return
            }
            if (result.kind === "ended") {
                await notifyEnded(roomId, result.room, "call:rejected")
                ack?.({ success: true, state: null })
            } else {
                clearCallRingTimeout(roomId, result.room)
                sendCallIceServers(io, result.room.beginer_id, result.room.receiver_id)
                const snapshot = await publish(roomId, result.room)
                if (snapshot) emitCallConfirmed(io, roomId, snapshot.room)
                ack?.({ success: true, state: snapshot?.state ?? null })
            }
        } catch (error) {
            console.error("call:confirm", error)
            ack?.({ err: "Не удалось ответить на звонок" })
        }
    })

    socket.on("call:end", async (data: CallRoomIdPayload) => {
        if (!isOptionalCallRevision(data?.ownershipRevision)) return
        try {
            const { roomId } = data
            const room = await getRoom(roomId ?? "")
            if (!room) return
            if (!isCallParticipant(room, uid)) return

            await socket.data.callEndpointReady
            const result = await callStore.transition(roomId ?? "", uid, "end", {
                ...mediaActor(socket, uid),
                ownershipRevision: data.ownershipRevision,
                ...expectCallInstance(room)
            })
            if (result.kind === "ended" && result.room) await notifyEnded(roomId ?? "", result.room)
        } catch (err) {
            console.log("call:end error", err)
        }
    })
}
