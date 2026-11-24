import type { PoolClient } from "pg"
import { pool } from "../shared/config"
import type { PushEvent } from "../shared/types/contracts/push"

export async function enqueuePush(event: PushEvent, db: Pick<PoolClient, "query"> = pool): Promise<void> {
    const recipients = event.recipients.filter((id) => id !== event.senderId)
    if (!recipients.length) {
        return
    }
    await db.query(
        `INSERT INTO push_outbox(
            device_id, event_key, chat_key, sender_id, room_id, message_id,
            call_room_id, target, title, expires_at
         )
         SELECT d.id, $2, $3::text, $4, $5, $6, $7,
                $8::jsonb || jsonb_build_object('userId', d.user_id), $9, $10
         FROM push_devices d
         JOIN auth_sessions s ON s.id = d.session_id AND s.user_id = d.user_id
         JOIN users u ON u.id = d.user_id
         WHERE d.user_id = ANY($1::int[]) AND d.enabled AND NOT (d.muted_chats ? $3::text)
           AND s.revoked_at IS NULL AND s.expires_at > NOW()
           AND s.session_version = u.auth_version AND NOT u.is_blocked
         ON CONFLICT (device_id, event_key) DO NOTHING`,
        [
            recipients,
            event.eventKey,
            event.chatKey,
            event.senderId,
            event.roomId ?? null,
            event.messageId ?? null,
            event.callRoomId ?? null,
            JSON.stringify(event.target),
            event.title.slice(0, 120),
            new Date(event.expiresAt)
        ]
    )
}
