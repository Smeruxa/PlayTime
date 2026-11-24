import type { PoolClient } from "pg"
import type { UserBlockState } from "../../shared/runtime/authContracts"
import { pool } from "../../shared/config"

export async function isUserAccountBlocked(userId: number): Promise<boolean> {
    const r = await pool.query<{ is_blocked: boolean }>("SELECT is_blocked FROM users WHERE id = $1", [userId])
    return r.rows[0]?.is_blocked === true
}

export async function setUserBlocked(
    userId: number,
    blocked: boolean,
    reason: string | null,
    db: Pick<PoolClient, "query"> = pool
): Promise<UserBlockState | null> {
    const r = await db.query<{
        is_blocked: boolean
        blocked_at: Date | null
        blocked_reason: string | null
    }>(
        `UPDATE users SET
            is_blocked = $2,
            blocked_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
            blocked_reason = CASE WHEN $2 THEN $3 ELSE NULL END
         WHERE id = $1
         RETURNING is_blocked, blocked_at, blocked_reason`,
        [userId, blocked, reason?.trim() || null]
    )
    const row = r.rows[0]
    if (!row) return null
    return {
        isBlocked: row.is_blocked,
        blockedAt: row.blocked_at?.toISOString() ?? null,
        blockedReason: row.blocked_reason
    }
}
