import { JsonWebTokenError } from "jsonwebtoken"
import { assertAccessSessionActive, verifyUserAccessToken, type AccessTokenPayload } from "./accessToken"
import { pool, redis } from "../../shared/config"
import type { AuthedUser } from "../../shared/socket/featureContext"

async function checkAccountLock(userId: number, allowUnavailableRedis = false): Promise<void> {
    const ttl = await redis.ttl(`acct_locked:${userId}`).catch((error: unknown) => {
        if (!allowUnavailableRedis) throw error
        console.error("authSocket redis", error)
        return -2
    })
    if (ttl >= -1) throw new Error("account locked")
}

export async function verifySocketSession(
    token: string,
    allowUnavailableRedis = false
): Promise<{ session: AccessTokenPayload; user: AuthedUser }> {
    const session = await verifyUserAccessToken(token)
    await checkAccountLock(session.id, allowUnavailableRedis)
    const { rows } = await pool.query<AuthedUser>(
        "SELECT id, username FROM users WHERE id = $1 AND is_blocked = FALSE AND guest_archived_at IS NULL",
        [session.id]
    )
    const user = rows[0]
    if (!user) throw new Error("token revoked")
    return { session, user }
}

export async function checkSocketSession(session: AccessTokenPayload): Promise<void> {
    await assertAccessSessionActive(session)
    await checkAccountLock(session.id)
}

export function isSessionPayload(value: unknown): value is AccessTokenPayload {
    if (!value || typeof value !== "object") return false
    const { id, username, jti, exp, sessionVersion, sessionId } =
        value as Partial<Record<keyof AccessTokenPayload, unknown>>
    return (
        typeof id === "number" &&
        Number.isInteger(id) &&
        id > 0 &&
        id <= 2147483647 &&
        typeof username === "string" &&
        username.length > 0 &&
        typeof jti === "string" &&
        jti.length > 0 &&
        jti.length <= 128 &&
        typeof exp === "number" &&
        Number.isFinite(exp) &&
        typeof sessionVersion === "number" &&
        Number.isSafeInteger(sessionVersion) &&
        sessionVersion >= 0 &&
        (sessionId === undefined ||
            (typeof sessionId === "string" &&
                /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(sessionId)))
    )
}

const rejectedSessions = new Set([
    "token expired",
    "token revoked",
    "invalid token",
    "invalid token payload",
    "invalid session id",
    "account locked"
])

export function sessionFailureStatus(error: unknown): 401 | 503 {
    return error instanceof JsonWebTokenError || (error instanceof Error && rejectedSessions.has(error.message))
        ? 401
        : 503
}

export { assertAccessSessionActive }
