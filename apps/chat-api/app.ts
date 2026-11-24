import type { Express } from "express"
import { configureBearerAccess } from "../shared/http/bearerAuth"
import { requestBearerAccess } from "../shared/runtime/authContracts"
import { createPresence } from "../shared/runtime/presence"
import { resolveAuthedUser, type FeatureContext, type FeatureIo } from "../shared/socket/featureContext"
import registerFriendship from "./socket/friendship"
import registerMessages from "./socket/messages"
import registerPartyRoomsDb from "./socket/roomsDb"
import registerProfile from "./socket/profile"
import type { PeerBlockEffects } from "./services/peerBlock"
import { chatPath } from "../shared/runtime/chatContracts"
import { requestRoomBlockPeers } from "../shared/runtime/roomContracts"
import { makeCallRoutes } from "./callRoutes"
import chatPublicRoutes from "./http/publicRoutes"
import { startChatMaintenance } from "./maintenance"
import { listPresenceFriends, makePeerRoutes } from "./peerRoutes"
import { makeRoomPolicyRoutes } from "./roomPolicyRoutes"
import reportRoutes from "./reportRoutes"
import { peerEventRoom } from "./socket/peerIdentity"

async function onlineFromGateways(io: FeatureIo, ids: number[]): Promise<Set<number>> {
    const sockets = await io.in(ids.map(String)).fetchSockets()
    return new Set(
        sockets.flatMap((socket) => {
            const user = resolveAuthedUser(socket)
            return user ? [user.id] : []
        })
    )
}

export const chatPresence = createPresence({
    friends: listPresenceFriends,
    audience: peerEventRoom,
    online: process.env.PLAYTIME_DOMAIN_ROLLOUT === "1" ? onlineFromGateways : undefined
})

function peerBlockEffects(io: FeatureIo): PeerBlockEffects {
    return {
        friendsChanged(userId, peerId) {
            chatPresence.invalidatePresenceFriends(userId, peerId)
            io.serverSideEmit("playtime:presenceFriendsChanged", [userId, peerId])
        },
        endCall: requestRoomBlockPeers
    }
}

export async function configureChatApi(app: Express, io: FeatureIo): Promise<() => void> {
    configureBearerAccess(app, requestBearerAccess)
    app.set("io", io)
    app.locals.peerBlockEffects = peerBlockEffects(io)
    app.use(chatPublicRoutes)
    app.use(chatPath, makePeerRoutes(), makeRoomPolicyRoutes(), makeCallRoutes(io), reportRoutes)

    return startChatMaintenance()
}

export function registerChatSocketFeatures(ctx: FeatureContext): void {
    chatPresence.registerPresenceHandlers(ctx)
    registerFriendship(ctx, peerBlockEffects(ctx.io))
    registerMessages(ctx)
    registerPartyRoomsDb(ctx)
    registerProfile(ctx)
}
