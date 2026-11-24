import crypto from "node:crypto"
import { revokeGuestDevice } from "./guestLifecycle"
import type { PoolClient } from "pg"
import { pool } from "../../shared/config"

export const REFRESH_TOKEN_HEX_LENGTH = 64
export type SessionUser = { id: number; username: string; sessionVersion: number; sessionId?: string }
export type SessionMetadata = { deviceName?: string; userAgent?: string }
const tokenHash = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex")
const validToken = (raw: unknown): raw is string => typeof raw === "string" && /^[a-f0-9]{64}$/.test(raw)

export function refreshTokenTtlSeconds(): number {
    const days = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30)
    return Math.min(365, Math.max(1, Number.isFinite(days) ? days : 30)) * 86400
}

export async function issueRefreshToken(
    user: SessionUser,
    metadata: SessionMetadata = {},
    options: { client?: Pick<PoolClient, "query">; token?: string } = {}
): Promise<string> {
    if (!options.client) {
        const client = await pool.connect()
        try {
            await client.query("BEGIN")
            const raw = await issueRefreshToken(user, metadata, { ...options, client })
            await client.query("COMMIT")
            return raw
        } catch (error) {
            await client.query("ROLLBACK").catch(() => {})
            throw error
        } finally {
            client.release()
        }
    }
    await options.client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user.id])
    const raw = options.token ?? crypto.randomBytes(32).toString("hex")
    const id = user.sessionId ?? crypto.randomUUID()
    const ttl = refreshTokenTtlSeconds()
    const result = await (options.client ?? pool).query(
        `INSERT INTO auth_sessions(id, user_id, refresh_token_hash, session_version, expires_at, device_name, user_agent)
         SELECT $1, id, $3, $4, NOW() + $5 * INTERVAL '1 second', $6, $7 FROM users WHERE id = $2 AND auth_version = $4 AND is_blocked = FALSE AND guest_archived_at IS NULL
         ON CONFLICT(id) DO UPDATE SET refresh_token_hash = EXCLUDED.refresh_token_hash, last_seen_at = NOW(), expires_at = EXCLUDED.expires_at
         WHERE auth_sessions.revoked_at IS NULL AND auth_sessions.session_version = EXCLUDED.session_version
         RETURNING id`,
        [
            id,
            user.id,
            tokenHash(raw),
            user.sessionVersion,
            ttl,
            (metadata.deviceName || "PlayTime").slice(0, 160),
            (metadata.userAgent || "").slice(0, 300)
        ]
    )
    if (!result.rows.length) throw new Error("Session revoked")
    user.sessionId = id
    return raw
}

export async function takeRefreshToken(raw: string): Promise<SessionUser | null> {
    if (!validToken(raw)) return null
    const result = await pool.query<{ id: number; username: string; session_version: string; session_id: string }>(
        `UPDATE auth_sessions s SET refresh_token_hash = NULL, last_seen_at = NOW()
         FROM users u WHERE s.refresh_token_hash = $1 AND s.user_id = u.id AND s.revoked_at IS NULL
           AND s.expires_at > NOW() AND s.session_version = u.auth_version AND u.is_blocked = FALSE
         RETURNING u.id, u.username, s.session_version, s.id AS session_id`,
        [tokenHash(raw)]
    )
    const row = result.rows[0]
    return row
        ? { id: row.id, username: row.username, sessionVersion: Number(row.session_version), sessionId: row.session_id }
        : null
}

export async function deleteRefreshToken(raw: string): Promise<string | undefined> {
    if (!validToken(raw)) return
    const found = (
        await pool.query<{ id: string; user_id: number }>(
            "SELECT id, user_id FROM auth_sessions WHERE refresh_token_hash=$1",
            [tokenHash(raw)]
        )
    ).rows[0]
    if (found) {
        await revokeGuestDevice(found.user_id, found.id)
        return found.id
    }
}

export async function revokeAllRefreshTokensForUser(
    userId: number,
    db: Pick<PoolClient, "query"> = pool
): Promise<void> {
    await db.query(
        "UPDATE auth_sessions SET revoked_at = NOW(), refresh_token_hash = NULL WHERE user_id = $1 AND revoked_at IS NULL",
        [userId]
    )
}

export async function isDeviceSessionActive(sessionId: string, userId: number): Promise<boolean> {
    const result = await pool.query(
        "SELECT 1 FROM auth_sessions WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > NOW()",
        [sessionId, userId]
    )
    return result.rows.length > 0
}
