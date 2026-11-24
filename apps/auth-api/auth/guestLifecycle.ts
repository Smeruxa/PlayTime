import crypto from "node:crypto"
import type { PoolClient } from "pg"
import { pool } from "../../shared/config"

export function isGuestNicknameReuseEnabled(env: Record<string, string | undefined> = process.env): boolean {
    const flag = env.GUEST_NICKNAME_REUSE_ENABLED
    if (flag !== undefined) return flag === "1" || flag === "true"
    return env.NODE_ENV !== "production"
}

type GuestArchiveListener = (userId: number) => Promise<void> | void
let archiveListener: GuestArchiveListener | undefined

export function setGuestArchiveListener(listener: GuestArchiveListener | undefined): void {
    archiveListener = listener
}

export async function notifyGuestArchived(userId: number): Promise<void> {
    await archiveListener?.(userId)
}

type Guest = {
    username: string
    is_guest: boolean
    guest_registration_pending: boolean
    guest_archived_at: Date | null
}

export async function archiveGuestIfInactive(
    client: PoolClient,
    userId: number,
    reason: "logout" | "expiry"
): Promise<boolean> {
    if (!isGuestNicknameReuseEnabled()) return false
    const user = (
        await client.query<Guest>(
            "SELECT username, is_guest, guest_registration_pending, guest_archived_at FROM users WHERE id=$1 FOR UPDATE",
            [userId]
        )
    ).rows[0]
    if (!user || !user.is_guest || user.guest_registration_pending || user.guest_archived_at) return false
    const sessions = (
        await client.query<{ live: boolean; recent: boolean }>(
            `SELECT revoked_at IS NULL AND expires_at>NOW() AS live,
                COALESCE(revoked_at, expires_at)>NOW()-INTERVAL '1 hour' AS recent
         FROM auth_sessions WHERE user_id=$1 ORDER BY id FOR UPDATE`,
            [userId]
        )
    ).rows
    if (!sessions.length || sessions.some((session) => session.live)) return false
    if (reason === "expiry" && sessions.some((session) => session.recent)) return false
    await client.query(
        `INSERT INTO username_reclaims(username, former_user_id) VALUES ($1,$2)
         ON CONFLICT (username) DO UPDATE SET released_at=NOW(), former_user_id=EXCLUDED.former_user_id`,
        [user.username, userId]
    )
    await client.query(
        `UPDATE users SET guest_original_username=username, username=$2, guest_archived_at=NOW(), auth_version=auth_version+1 WHERE id=$1`,
        [userId, `~guest:${userId}:${crypto.randomBytes(8).toString("hex")}`]
    )
    await client.query(
        "UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,NOW()), refresh_token_hash=NULL WHERE user_id=$1",
        [userId]
    )
    return true
}

export async function revokeGuestDevice(userId: number, sessionId: string): Promise<void> {
    const client = await pool.connect()
    let archived = false
    try {
        await client.query("BEGIN")
        await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId])
        const result = await client.query(
            "UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,NOW()), refresh_token_hash=NULL WHERE id=$1 AND user_id=$2 RETURNING id",
            [sessionId, userId]
        )
        archived = result.rows.length ? await archiveGuestIfInactive(client, userId, "logout") : false
        await client.query("COMMIT")
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {})
        throw error
    } finally {
        client.release()
    }
    if (archived) await notifyGuestArchived(userId)
}

export async function cleanupExpiredGuests(): Promise<void> {
    const candidates = (
        await pool.query<{ id: number }>(
            `SELECT u.id FROM users u WHERE u.is_guest=TRUE AND u.guest_registration_pending=FALSE
         AND u.guest_archived_at IS NULL
         AND EXISTS (SELECT 1 FROM auth_sessions s WHERE s.user_id=u.id)
         AND NOT EXISTS (SELECT 1 FROM auth_sessions s WHERE s.user_id=u.id
             AND ((s.revoked_at IS NULL AND s.expires_at>NOW()) OR COALESCE(s.revoked_at, s.expires_at)>NOW()-INTERVAL '1 hour'))
         ORDER BY u.id LIMIT 1000`
        )
    ).rows
    for (const { id } of candidates) {
        const client = await pool.connect()
        let archived = false
        try {
            await client.query("BEGIN")
            archived = await archiveGuestIfInactive(client, id, "expiry")
            await client.query("COMMIT")
        } catch (error) {
            await client.query("ROLLBACK").catch(() => {})
            throw error
        } finally {
            client.release()
        }
        if (archived) await notifyGuestArchived(id)
    }
}
