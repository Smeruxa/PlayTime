import { redis } from "../../../shared/redis"
import type { FeatureIo } from "../../../shared/socket/featureContext"
import { partyParticipantFromFetched } from "../../../shared/socket/remoteParticipant"
import { createPartyDepartureStore } from "./departureStore"
import { withVoiceRoomLock } from "./voiceRoomLock"

export const partyDepartures = createPartyDepartureStore(redis)
export const PARTY_RECONNECT_GRACE_MS = 15_000
export const PARTY_SOCKET_ROOM_PREFIX = "room:"

export async function isInParty(io: FeatureIo, roomName: string, userId: number): Promise<boolean> {
    const sockets = await io.in(roomName).fetchSockets()
    return sockets.some((socket) => partyParticipantFromFetched(socket)?.userId === userId)
}

export function startPartyDepartureWorker(io: FeatureIo, hasGatewayLinks: () => boolean): () => void {
    let working = false
    const tick = async () => {
        if (working || !hasGatewayLinks()) return
        working = true
        try {
            const now = Date.now()
            for (const departure of await partyDepartures.due(now)) {
                await withVoiceRoomLock(departure.roomId, async (renew) => {
                    if (!hasGatewayLinks()) return
                    const roomName = PARTY_SOCKET_ROOM_PREFIX + departure.roomId
                    const online = await isInParty(io, roomName, departure.userId)
                    await renew()
                    if (!hasGatewayLinks()) return
                    const username = await partyDepartures.remove(departure, now)
                    if (username && !online) io.to(roomName).emit("party:participant:left", { userId: departure.userId, username })
                })
            }
        } catch (error) {
            console.error("Party departure temporarily unavailable", error)
        } finally {
            working = false
        }
    }
    const timer = setInterval(() => void tick(), 1000).unref()
    return () => clearInterval(timer)
}
