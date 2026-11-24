import type { Socket } from "socket.io"
import type { SocketSnapshot } from "../shared/runtime/socketProtocol"
import { resolveAuthedUser } from "../shared/socket/featureContext"

export function socketHandshake(socket: Socket): SocketSnapshot["auth"] {
    const { peerIdentityProtocol, callProtocol, callEndpointId } = socket.handshake.auth
    return {
        peerIdentityProtocol: typeof peerIdentityProtocol === "number" ? peerIdentityProtocol : undefined,
        callProtocol: typeof callProtocol === "number" ? callProtocol : undefined,
        callEndpointId: typeof callEndpointId === "string" ? callEndpointId : undefined
    }
}

export function socketSnapshot(socket: Socket): SocketSnapshot {
    const user = resolveAuthedUser(socket)
    if (!user) throw new Error("Socket is unauthenticated")
    return {
        id: socket.id,
        user,
        session: socket.data.accessSession,
        auth: socketHandshake(socket),
        rooms: Array.from(socket.rooms),
        roomRevision: socket.data.roomRevision ?? 0,
        sessionRevision: socket.data.sessionRevision ?? 0
    }
}
