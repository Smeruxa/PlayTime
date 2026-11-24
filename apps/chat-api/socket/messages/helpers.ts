import { emitPeerEvent } from "../peerIdentity"
import type { PoolClient } from "pg"
import type { FeatureIo } from "../../../shared/socket/featureContext"
import { pool } from "../../../shared/deps"
import type { RowMessageId, RowMid } from "../../../shared/types/db"

export { pool }

export function parsePositiveInt(value: unknown): number {
    const n = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : 0
    return Number.isFinite(n) && n > 0 ? n : 0
}

export function normalizeUsername(raw: unknown): string {
    if (raw == null) return ""
    const s = typeof raw === "string" ? raw : String(raw)
    return s.trim().slice(0, 50)
}

export interface ReplyPayload {
    id: number
    from: string
    preview: string
}

export function buildReplyPayload(
    replyToId: number | null,
    replyFrom: string | null,
    replyPreview: string | null
): ReplyPayload | null {
    if (!replyToId) return null
    return {
        id: replyToId,
        from: replyFrom || "",
        preview: replyPreview || ""
    }
}

export async function markDmInboundReadAndNotify(
    io: Pick<FeatureIo, "to">,
    readerId: number,
    readerUsername: string,
    peerId: number
): Promise<void> {
    const markRes = await pool.query<RowMessageId>(
        `UPDATE messages SET read = true
         WHERE receiver_id = $1 AND sender_id = $2 AND read = false
         RETURNING id`,
        [readerId, peerId]
    )
    if (markRes.rows.length === 0) return
    await emitPeerEvent(io, peerId, [readerId, peerId], "message:read", {
        readerUsername,
        readerUserId: readerId,
        messageIds: markRes.rows.map((r) => r.id)
    })
}

export async function bumpRoomRead(userId: number, roomId: number): Promise<void> {
    const maxR = await pool.query<RowMid>(`SELECT COALESCE(MAX(id), 0) AS mid FROM messages WHERE room_id = $1`, [
        roomId
    ])
    const mid = maxR.rows[0].mid
    await pool.query(
        `INSERT INTO room_read_state (room_id, user_id, last_read_message_id, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (room_id, user_id) DO UPDATE SET
           last_read_message_id = GREATEST(room_read_state.last_read_message_id, EXCLUDED.last_read_message_id),
           updated_at = NOW()`,
        [roomId, userId, mid]
    )
}

export interface MessageRowForEmit {
    reply_to_id: number | null
    reply_from: string | null
    reply_preview: string | null
}

export async function loadMessageRowForEmit(
    messageId: number,
    db: Pick<PoolClient, "query"> = pool
): Promise<MessageRowForEmit | null> {
    const r = await db.query<MessageRowForEmit>(
        `SELECT m.id, m.room_id, m.receiver_id, m.sender_id, m.content, m.created_at, m.read, m.reply_to_id,
                COALESCE(u_from.guest_original_username, u_from.username) AS sender_username,
                COALESCE(ru.guest_original_username, ru.username) AS reply_from,
                CASE
                    WHEN r.is_dm_e2ee OR r.content LIKE 'E2E1:%' THEN '[Защищено сквозным шифрованием]'
                    WHEN r.content LIKE 'R2E1:%' THEN '[Защищено сквозным шифрованием]'
                    ELSE LEFT(r.content, 120)
                END AS reply_preview
         FROM messages m
         JOIN users u_from ON u_from.id = m.sender_id
         LEFT JOIN messages r ON r.id = m.reply_to_id
         LEFT JOIN users ru ON ru.id = r.sender_id
         WHERE m.id = $1`,
        [messageId]
    )
    return r.rows[0] ?? null
}
