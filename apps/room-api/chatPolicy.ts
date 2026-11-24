import { isDatabaseId, requestChat } from "../shared/runtime/chatContracts"
import type { DirectCallServices } from "./socket/directCall"
import type { PartyRoomServices } from "./socket/party/roomsSocket"

function relationship(userId: number, peerId: number) {
    return requestChat("relationship", { userId, peerId })
}

export const directCallServices: DirectCallServices = {
    async resolvePeer(peerUserId, username) {
        if (peerUserId !== undefined) {
            if (!isDatabaseId(peerUserId)) return null
            return (await requestChat("peer", { peerUserId })).peer
        }
        if (typeof username !== "string" || !username.trim() || username.length > 50) return null
        return (await requestChat("peer", { username })).peer
    },
    users: async (userIds) => (await requestChat("users", { userIds })).users,
    peerEventRoom: async (recipientId, participantIds) =>
        (await requestChat("audience", { recipientId, participantIds })).room,
    canCall: async (userId, peerId) => (await relationship(userId, peerId)).canCall,
    async screenFps(userId) {
        const { limits } = await requestChat("limits", { userId })
        if (!limits) throw new Error("Screen-share limits unavailable")
        return limits.maxScreenBroadcastFps
    },
    async enqueueIncomingCall(input) {
        await requestChat("call-push", input)
    }
}

export const partyServices: PartyRoomServices = {
    isMember: async (roomId, userId) => (await requestChat("membership", { roomId, userId })).member,
    limits: async (roomId) => (await requestChat("limits", { roomId })).limits
}

export async function areCallPeersBlocked(userId: number, peerId: number): Promise<boolean> {
    return (await relationship(userId, peerId)).blocked
}
