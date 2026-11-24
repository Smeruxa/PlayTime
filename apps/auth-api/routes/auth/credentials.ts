import { Router, type RequestHandler } from "express"
import {
    AuthRetryError,
    getAccessTokenTtlSeconds,
    REFRESH_TOKEN_HEX_LENGTH,
    rotateRefreshSession,
    signUserAccessToken,
    validAuthRequestKey,
    verifyUserAccessToken
} from "../../auth"
import { revokeSubmittedCredentials, type RevocationInput } from "../../auth/revokeCredentials"
import type { createAuthRateLimiters } from "../../http/authRateLimits"
import { pool, redis } from "../../../shared/config"
import type { FeatureIo } from "../../../shared/socket/featureContext"
import { accountView, LOGIN_THROTTLED, TOKEN_TOO_LARGE, type AccountRow } from "./account"

const refresh: RequestHandler = async (req, res) => {
    const { refreshToken, requestKey } = req.body as { refreshToken?: string; requestKey?: unknown }
    if (typeof refreshToken !== "string" || refreshToken.length > REFRESH_TOKEN_HEX_LENGTH + 4) {
        return res.status(400).json({ error: "Invalid body" })
    }
    if (requestKey !== undefined && !validAuthRequestKey(requestKey))
        return res.status(400).json({ error: "Invalid request key" })

    try {
        const {
            user,
            session,
            refreshToken: newRefresh
        } = await rotateRefreshSession(refreshToken, requestKey, async (id) => {
            if ((await redis.ttl(`acct_locked:${id}`)) > 0) throw new AuthRetryError(401, LOGIN_THROTTLED)
        })
        const token = signUserAccessToken(session)
        res.json({
            token,
            refreshToken: newRefresh,
            expiresIn: getAccessTokenTtlSeconds(),
            user: accountView(user)
        })
    } catch (err) {
        if (err instanceof AuthRetryError)
            return res
                .status(err.status)
                .json({ error: err.message, ...(err.retrySuperseded ? { retrySuperseded: true } : {}) })
        console.error("refresh failed")
        res.status(500).json({ error: "Server error" })
    }
}

const revoke: RequestHandler = async (req, res) => {
    try {
        await revokeSubmittedCredentials((req.body ?? {}) as RevocationInput, TOKEN_TOO_LARGE, (room) => {
            const io = req.app.get("io") as FeatureIo | undefined
            io?.in(room).disconnectSockets(true)
        })
        res.json({ ok: true })
    } catch (error) {
        console.error("revoke failed", error)
        res.status(503).json({ error: "Не удалось завершить сеанс. Повторите попытку." })
    }
}

const tokenValid: RequestHandler = async (req, res) => {
    const { token } = req.body as { token?: string }
    if (typeof token !== "string" || !token.trim())
        return res.status(400).json({ valid: false, error: "No token provided" })
    if (token.length > TOKEN_TOO_LARGE) return res.status(400).json({ valid: false, error: "Invalid token" })

    try {
        const decoded = await verifyUserAccessToken(token)
        const lockTtl = await redis.ttl(`acct_locked:${decoded.id}`)
        if (lockTtl > 0) {
            return res.status(401).json({
                valid: false,
                locked: true,
                error: LOGIN_THROTTLED
            })
        }
        const row = await pool.query<AccountRow & { is_blocked: boolean }>(
            "SELECT id, username, email, is_blocked, is_guest, guest_registration_pending FROM users WHERE id = $1",
            [decoded.id]
        )
        if (row.rows.length === 0) return res.status(401).json({ valid: false, error: "Invalid or expired token" })
        if (row.rows[0].is_blocked) {
            return res.status(403).json({ valid: false, blocked: true, error: "Account blocked" })
        }
        res.json({
            valid: true,
            expiresIn: getAccessTokenTtlSeconds(),
            user: accountView(row.rows[0])
        })
    } catch {
        res.status(401).json({ valid: false, error: "Invalid or expired token" })
    }
}

type CredentialLimiters = Pick<
    ReturnType<typeof createAuthRateLimiters>,
    "refreshLimiter" | "revokeLimiter" | "tokenValidLimiter"
>

export function createCredentialRoutes(limiters: CredentialLimiters) {
    const router = Router()
    router.post("/refresh", limiters.refreshLimiter, refresh)
    router.post("/revoke", limiters.revokeLimiter, revoke)
    router.post("/tokenValid", limiters.tokenValidLimiter, tokenValid)
    return router
}
