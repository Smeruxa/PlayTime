import {
    blacklistAccessJti,
    deleteRefreshToken,
    REFRESH_TOKEN_HEX_LENGTH,
    revokeHashedRefresh,
    revokeRetryableRefresh,
    validAuthRequestKey,
    verifyUserAccessToken
} from "."
import { accessSessionRoom, deviceSessionRoom } from "./sessionVersion"
import { revokeDeviceSession } from "./revokeDeviceSession"

export type RevocationInput = {
    token?: unknown
    refreshToken?: unknown
    requestKey?: unknown
    refreshTokenHash?: unknown
}

export async function revokeSubmittedCredentials(
    { token, refreshToken, requestKey, refreshTokenHash }: RevocationInput,
    maxTokenLength: number,
    disconnect: (room: string) => void
): Promise<void> {
    if (typeof token === "string" && token.length > 0 && token.length <= maxTokenLength) {
        let access
        try {
            access = await verifyUserAccessToken(token)
        } catch (error) {
            const err = error as Error
            const rejected =
                ["JsonWebTokenError", "TokenExpiredError", "NotBeforeError"].includes(err.name) ||
                [
                    "token expired",
                    "token revoked",
                    "invalid token",
                    "invalid token payload",
                    "invalid session id"
                ].includes(err.message)
            if (!rejected) throw error
        }
        if (access) {
            if (access.sessionId) {
                await revokeDeviceSession(access.id, access.sessionId)
                disconnect(deviceSessionRoom(access.sessionId))
            }
            await blacklistAccessJti(access.jti, access.exp)
            disconnect(accessSessionRoom(access.jti))
        }
    }
    if (typeof refreshToken === "string" && refreshToken.length <= REFRESH_TOKEN_HEX_LENGTH + 4) {
        const revokedId =
            requestKey !== undefined && validAuthRequestKey(requestKey)
                ? await revokeRetryableRefresh(refreshToken, requestKey)
                : await deleteRefreshToken(refreshToken)
        if (revokedId) disconnect(deviceSessionRoom(revokedId))
    }
    if (typeof refreshTokenHash === "string" && validAuthRequestKey(refreshTokenHash)) {
        const revokedId = await revokeHashedRefresh(refreshTokenHash)
        if (revokedId) disconnect(deviceSessionRoom(revokedId))
    }
}
