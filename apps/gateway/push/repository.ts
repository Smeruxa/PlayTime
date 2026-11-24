import { createHash, randomUUID } from "node:crypto"
import { pool } from "../../shared/config"
import type { PushQueue } from "./dispatcher"
import type { PushDelivery, PushRegistration, PushTarget } from "./types"

export class PushRegistrationSessionError extends Error {
    constructor() {
        super("Push registration session is inactive")
    }
}

export async function registerPushDevice(userId: number, sessionId: string, input: PushRegistration): Promise<void> {
    const tokenHash = createHash("sha256").update(input.token).digest("hex")
    const db = await pool.connect()
    try {
        await db.query("BEGIN")
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`push:${sessionId}`])
        const session = await db.query(
            `SELECT s.id FROM auth_sessions s JOIN users u ON u.id = s.user_id
             WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL AND s.expires_at > NOW()
               AND s.session_version = u.auth_version AND NOT u.is_blocked
             FOR UPDATE OF u`,
            [sessionId, userId]
        )
        if (!session.rows.length) {
            throw new PushRegistrationSessionError()
        }
        await db.query("DELETE FROM push_devices WHERE session_id = $1 AND provider = $2 AND token_hash <> $3", [
            sessionId,
            input.provider,
            tokenHash
        ])
        await db.query(
            `DELETE FROM push_outbox WHERE device_id IN (
                SELECT id FROM push_devices WHERE provider = $1 AND token_hash = $2 AND session_id <> $3
            )`,
            [input.provider, tokenHash, sessionId]
        )
        await db.query(
            `INSERT INTO push_devices(id, user_id, session_id, provider, token, token_hash, enabled, muted_chats)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
             ON CONFLICT (provider, token_hash) DO UPDATE SET
                user_id = EXCLUDED.user_id, session_id = EXCLUDED.session_id,
                token = EXCLUDED.token, enabled = EXCLUDED.enabled,
                muted_chats = EXCLUDED.muted_chats, updated_at = NOW()`,
            [
                randomUUID(),
                userId,
                sessionId,
                input.provider,
                input.token,
                tokenHash,
                input.enabled,
                JSON.stringify(input.mutedChats)
            ]
        )
        if (!input.enabled) {
            await db.query(
                "DELETE FROM push_outbox WHERE device_id IN (SELECT id FROM push_devices WHERE session_id = $1)",
                [sessionId]
            )
        }
        await db.query("COMMIT")
    } catch (error) {
        await db.query("ROLLBACK").catch(() => undefined)
        throw error
    } finally {
        db.release()
    }
}

export async function removePushDevice(userId: number, sessionId: string): Promise<void> {
    await pool.query("DELETE FROM push_devices WHERE user_id = $1 AND session_id = $2", [userId, sessionId])
}

type DeliveryRow = {
    id: string
    device_id: string
    token: string
    event_key: string
    target: PushTarget
    title: string
    message_id: number | null
    call_room_id: string | null
    expires_at: Date
    attempts: number
}

export type CallPushPolicy = (roomId: string, recipientId: number) => Promise<boolean>

export function createPushQueue(allowsRingingPush: CallPushPolicy): PushQueue {
    return {
        async claim() {
            await pool.query("DELETE FROM push_outbox WHERE expires_at <= NOW()")
            const result = await pool.query<DeliveryRow>(
                `WITH claimed AS (
                UPDATE push_outbox SET available_at = NOW() + INTERVAL '5 minutes', attempts = attempts + 1
                WHERE id IN (
                    SELECT id FROM push_outbox WHERE available_at <= NOW()
                    ORDER BY available_at, id FOR UPDATE SKIP LOCKED LIMIT 20
                ) RETURNING *
             ) SELECT c.*, d.token FROM claimed c JOIN push_devices d ON d.id = c.device_id`
            )
            return result.rows.map(
                (row): PushDelivery => ({
                    id: row.id,
                    deviceId: row.device_id,
                    token: row.token,
                    eventKey: row.event_key,
                    target: row.target,
                    title: row.title,
                    messageId: row.message_id,
                    callRoomId: row.call_room_id,
                    expiresAt: row.expires_at.getTime(),
                    attempts: row.attempts
                })
            )
        },
        async allowed(delivery) {
            const result = await pool.query(
                `SELECT 1 FROM push_outbox o
             JOIN push_devices d ON d.id = o.device_id AND d.user_id = (o.target->>'userId')::int
             JOIN auth_sessions s ON s.id = d.session_id AND s.user_id = d.user_id
             JOIN users u ON u.id = d.user_id
             WHERE o.id = $1 AND d.enabled AND d.token = $2
               AND NOT (d.muted_chats ? o.chat_key)
               AND s.revoked_at IS NULL AND s.expires_at > NOW()
               AND s.session_version = u.auth_version AND NOT u.is_blocked
               AND NOT EXISTS (
                   SELECT 1 FROM user_blocks b WHERE
                     (b.blocker_id = o.sender_id AND b.blocked_id = d.user_id)
                     OR (b.blocker_id = d.user_id AND b.blocked_id = o.sender_id)
               )
               AND (
                   (o.room_id IS NULL AND EXISTS (
                       SELECT 1 FROM friendships f WHERE f.status = 'accepted' AND
                         ((f.user_id = o.sender_id AND f.friend_id = d.user_id)
                         OR (f.friend_id = o.sender_id AND f.user_id = d.user_id))
                   ))
                   OR (o.room_id IS NOT NULL AND EXISTS (
                       SELECT 1 FROM room_members m
                       LEFT JOIN room_e2ee_wraps w ON w.room_id = m.room_id AND w.user_id = m.user_id
                       WHERE m.room_id = o.room_id AND m.user_id = d.user_id
                         AND o.message_id > w.e2ee_visible_after_id
                   ))
               )`,
                [delivery.id, delivery.token]
            )
            if (!result.rows.length) {
                return false
            }
            if (delivery.callRoomId) {
                return allowsRingingPush(delivery.callRoomId, delivery.target.userId)
            }
            return true
        },
        async complete(id) {
            await pool.query("DELETE FROM push_outbox WHERE id = $1", [id])
        },
        async invalidate(deviceId, token) {
            await pool.query("DELETE FROM push_devices WHERE id = $1 AND token = $2", [deviceId, token])
        },
        async retry(id, delaySeconds) {
            await pool.query("UPDATE push_outbox SET available_at = NOW() + $2 * INTERVAL '1 second' WHERE id = $1", [
                id,
                delaySeconds
            ])
        }
    }
}
