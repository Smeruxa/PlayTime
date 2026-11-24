import crypto from "node:crypto"
import type { FeatureRemoteSocket, FeatureSocket } from "../../../shared/socket/featureContext"
import { callStore } from "./redisService"
import { isOptionalCallRevision } from "./revision"
import type { CallActor, CallRoomJson } from "./callStore"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type CallSocket = Pick<FeatureRemoteSocket, "id" | "data" | "handshake">

export function callActor(socket: CallSocket, userId: number): CallActor | undefined {
    const endpoint = socket.handshake.auth.callEndpointId
    const sid = socket.data.accessSession?.sessionId
    if (socket.handshake.auth.callProtocol !== 3 || typeof endpoint !== "string" || !UUID.test(endpoint) || !sid)
        return undefined
    return {
        endpointKey: crypto
            .createHash("sha256")
            .update(JSON.stringify([userId, sid, endpoint]))
            .digest("hex"),
        socketId: socket.id,
        modern: true
    }
}

export function legacyCallActor(socket: CallSocket, userId: number): CallActor {
    return {
        endpointKey: crypto
            .createHash("sha256")
            .update(JSON.stringify([userId, socket.data.accessSession?.sessionId ?? "legacy", socket.id]))
            .digest("hex"),
        socketId: socket.id,
        sessionKey: socket.data.accessSession?.sessionId
            ? crypto
                  .createHash("sha256")
                  .update(JSON.stringify([userId, socket.data.accessSession.sessionId]))
                  .digest("hex")
            : undefined
    }
}

export function mediaActor(socket: CallSocket, userId: number): CallActor {
    return callActor(socket, userId) ?? legacyCallActor(socket, userId)
}

export function registerCallEndpoint(socket: CallSocket, userId: number, renewal = false): Promise<unknown> {
    const actor = mediaActor(socket, userId)
    const ready =
        socket.handshake.auth.callProtocol === 3 && !callActor(socket, userId)
            ? Promise.reject(new Error("Invalid call endpoint binding"))
            : renewal
              ? callStore.renewEndpoint(actor).then((renewed) => {
                    if (renewed !== 1) throw new Error("Call endpoint is leased to another socket")
                })
              : callStore.registerEndpoint(actor)
    socket.data.callEndpointReady = ready
    return ready
}

export async function attachLegacyOwner(socket: FeatureSocket, userId: number, roomId: string) {
    if (callActor(socket, userId)) return
    await socket.data.callEndpointReady
    const room = await callStore.get(roomId)
    const owner = room?.owners?.[String(userId)]
    if (!owner || owner.modern || owner.socketId === socket.id) return
    if ((await socket.nsp.in(owner.socketId).fetchSockets()).length) return
    await callStore.disconnectEndpoint(owner.socketId)
    await callStore.ownership(
        roomId,
        userId,
        "legacyAttach",
        { ...mediaActor(socket, userId), previousSocket: owner.socketId },
        owner.ownershipRevision
    )
}

export function mediaState(room: CallRoomJson, userId: number, actor?: CallActor) {
    const owner = room.owners?.[String(userId)]
    return {
        active:
            !room.owners || !!(owner && owner.endpointKey === actor?.endpointKey && owner.socketId === actor.socketId),
        canClaim: !!(
            room.takeoverEnabled &&
            room.status === "in_call" &&
            owner?.modern &&
            actor?.modern &&
            Object.values(room.owners ?? {}).length === 2 &&
            Object.values(room.owners ?? {}).every((entry) => entry.modern)
        ),
        ownershipRevision: owner?.ownershipRevision ?? 0
    }
}

export async function authorizeMedia(
    socket: FeatureSocket,
    userId: number,
    roomId: string,
    data?: { ownershipRevision?: number; targetOwnershipRevision?: number },
    signaling = true
) {
    if (!isOptionalCallRevision(data?.ownershipRevision) || !isOptionalCallRevision(data?.targetOwnershipRevision))
        return null
    await socket.data.callEndpointReady
    await attachLegacyOwner(socket, userId, roomId)
    const result = await callStore.ownership(
        roomId,
        userId,
        signaling ? "signal" : "authorize",
        mediaActor(socket, userId),
        data?.ownershipRevision,
        data?.targetOwnershipRevision
    )
    if (result.kind !== "existing" || !result.room) return null
    const room = result.room
    const peerId = room.beginer_id === userId ? room.receiver_id : room.beginer_id
    const peer = room.owners?.[String(peerId)]
    return {
        room,
        target: peer?.socketId ?? String(peerId),
        epochs: room.owners
            ? {
                  fromOwnershipRevision: room.owners[String(userId)]?.ownershipRevision,
                  targetOwnershipRevision: peer?.ownershipRevision
              }
            : {}
    }
}
