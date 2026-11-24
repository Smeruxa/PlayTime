import type { BearerAccessVerifier } from "../../shared/runtime/authContracts"
import { createBearerAuth } from "../../shared/http/bearerAuth"
import { verifyUserAccessToken } from "../auth/accessToken"
import { assertUserCanAuthenticate } from "../auth/userAuthGuard"
import { sessionFailureStatus } from "../auth/socketSession"

export type { AuthedRequest } from "../../shared/http/bearerAuth"

export const verifyBearerAccess: BearerAccessVerifier = async (token) => {
    try {
        const session = await verifyUserAccessToken(token)
        await assertUserCanAuthenticate(session.id)
        return { kind: "allowed", session }
    } catch (error) {
        if (error instanceof Error && (error.message === "account blocked" || error.message === "account locked")) {
            return { kind: "blocked" }
        }
        if (sessionFailureStatus(error) === 401) return { kind: "invalid" }
        throw error
    }
}

export const bearerAuthMiddleware = createBearerAuth((_req, token) => verifyBearerAccess(token))
