import type { Server, Socket } from "socket.io"
import type { AuthedUser } from "../../shared/socket/featureContext"
import registerPresenceHandlers from "../presence"
import registerFriendship from "../../chat-api/socket/friendship"
import registerMessages from "../../chat-api/socket/messages"
import { arePeersBlocked } from "../../chat-api/services/peerBlock"
import registerDirectCall from "../../room-api/socket/directCall"
import { localDirectCallServices } from "./directCallServices"
import { createLegacyPeerBlockEffects } from "./peerBlockEffects"
import registerParty from "./partySocket"
import registerAccount from "../../auth-api/socket/account"
import registerProfile from "../../chat-api/socket/profile"
import registerWebrtcSignaling from "../../room-api/socket/webrtc/signaling"
import { boundedFeatureSocket } from "../socketBudget"

export function attachSocketConnection(io: Server, socket: Socket, user: AuthedUser): void {
    const ctx = { io, socket: boundedFeatureSocket(socket, user.id), user }
    registerPresenceHandlers(ctx)
    registerFriendship(
        ctx,
        createLegacyPeerBlockEffects(() => io)
    )
    registerMessages(ctx)
    registerDirectCall(ctx, localDirectCallServices)
    registerParty(ctx)
    registerWebrtcSignaling(ctx, arePeersBlocked)
    registerAccount(ctx)
    registerProfile(ctx)
}
