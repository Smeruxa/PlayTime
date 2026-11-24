import type { PoolClient } from "pg"
import { pool } from "./helpers"

export async function canSeeRoomMessage(userId: number, roomId: number, messageId: number, db: Pick<PoolClient, "query"> = pool): Promise<boolean> {
    const result = await db.query(
        `SELECT 1 FROM messages m JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = $1
         LEFT JOIN room_e2ee_wraps rw ON rw.room_id = rm.room_id AND rw.user_id = rm.user_id
         WHERE m.id = $3 AND m.room_id = $2 AND m.id > GREATEST(rm.visible_after_id, COALESCE(rw.e2ee_visible_after_id, 0))`,
        [userId, roomId, messageId]
    )
    return result.rows.length > 0
}
export async function roomMessageRecipients(roomId: number, messageId: number, db: Pick<PoolClient, "query"> = pool): Promise<{ user_id: number; e2ee_visible_after_id: number }[]> {
    return (await db.query<{ user_id: number; e2ee_visible_after_id: number }>(
        `SELECT rm.user_id, GREATEST(rm.visible_after_id, COALESCE(rw.e2ee_visible_after_id, 0))::int AS e2ee_visible_after_id
         FROM room_members rm LEFT JOIN room_e2ee_wraps rw ON rw.room_id = rm.room_id AND rw.user_id = rm.user_id
         JOIN messages m ON m.room_id = rm.room_id AND m.id = $2
         WHERE rm.room_id = $1 AND m.id > GREATEST(rm.visible_after_id, COALESCE(rw.e2ee_visible_after_id, 0))`, [roomId, messageId]
    )).rows
}
