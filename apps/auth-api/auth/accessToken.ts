import crypto from "crypto"
import jwt from "jsonwebtoken"
import type { PoolClient } from "pg"
import { JWT_SECRET, pool } from "../../shared/config"
import type { AccessTokenPayload } from "../../shared/types/contracts/accessSession"

export type { AccessTokenPayload } from "../../shared/types/contracts/accessSession"

const VERIFY_OPTIONS: jwt.VerifyOptions = { algorithms: ["HS256"] }

export function getAccessTokenTtlSeconds(): number {
    const s = parseInt(process.env.ACCESS_TOKEN_TTL_SEC ?? "900", 10)
    return Number.isFinite(s) ? Math.min(86400, Math.max(60, s)) : 900
}

function accessTtlSeconds(): number {
    return getAccessTokenTtlSeconds()
}

export function signUserAccessToken(user: {
    id: number
    username: string
    sessionVersion: number
    sessionId?: string
}): string {
    const signOpts: jwt.SignOptions = {
        expiresIn: accessTtlSeconds(),
        algorithm: "HS256",
        jwtid: crypto.randomUUID()
    }
    return jwt.sign(
        { id: user.id, username: user.username, sv: user.sessionVersion, sid: user.sessionId },
        JWT_SECRET,
        signOpts
    )
}

export async function assertAccessSessionActive(session: AccessTokenPayload, db: Pick<PoolClient, "query"> = pool): Promise<void> {
    if (session.exp <= Date.now() / 1000) throw new Error("token expired")
    const result = await db.query(
        `SELECT 1 FROM users u WHERE u.id = $1 AND u.auth_version = $2 AND u.is_blocked = FALSE AND u.guest_archived_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM revoked_access_tokens r WHERE r.jti = $3 AND r.expires_at > NOW())
         AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM auth_sessions s WHERE s.id = $4 AND s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > NOW()))`,
        [session.id, session.sessionVersion, session.jti, session.sessionId ?? null]
    )
    if (!result.rows.length) throw new Error("token revoked")
}

export async function verifyUserAccessToken(token: string): Promise<AccessTokenPayload> {
    const decoded = jwt.verify(token, JWT_SECRET, VERIFY_OPTIONS)
    if (typeof decoded !== "object" || decoded == null) throw new Error("invalid token")
    const {
        id,
        username,
        jti,
        exp,
        sv = 0,
        sid
    } = decoded as jwt.JwtPayload & {
        id?: unknown
        username?: unknown
        jti?: unknown
    }
    if (typeof id !== "number" || !Number.isFinite(id) || typeof username !== "string" || !username) {
        throw new Error("invalid token payload")
    }
    if (typeof jti !== "string" || !jti || jti.length > 128) throw new Error("invalid token payload")
    if (typeof exp !== "number") throw new Error("invalid token payload")
    if (!Number.isSafeInteger(sv) || sv < 0) throw new Error("invalid token payload")
    if (
        sid !== undefined &&
        (typeof sid !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(sid))
    )
        throw new Error("invalid session id")
    const session = { id, username, jti, exp, sessionVersion: sv as number, sessionId: sid as string | undefined }
    await assertAccessSessionActive(session)
    return session
}
