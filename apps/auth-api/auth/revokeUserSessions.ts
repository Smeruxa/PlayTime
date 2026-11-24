import type { FeatureIo } from "../../shared/socket/featureContext"
import { revokeAllRefreshTokensForUser } from "./refreshToken"
import { revokeUserCredentials } from "./sessionVersion"

export async function revokeUserSessions(
    io: Pick<FeatureIo, "in" | "to">,
    userId: number,
    disconnect = true,
    invalidateCredentials = true
): Promise<void> {
    if (invalidateCredentials) await revokeUserCredentials(userId)
    await revokeAllRefreshTokensForUser(userId)
    try {
        if (disconnect) {
            io.to(userId.toString()).emit("session:revoked")
            io.in(userId.toString()).disconnectSockets(true)
        }
    } catch (e) {
        console.error("revokeUserSessions disconnect", userId, e)
    }
}
