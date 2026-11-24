import type { FeatureContext } from "../../../shared/socket/featureContext"
import { pool } from "./helpers"
import { socketAck } from "../../../shared/types/socket/ack"
import type { MessageLastPreviewsPayload } from "./contracts"

export default function registerMessagePreviews({ socket, user }: FeatureContext): void {
    socket.on("message:lastPreviews", async (callback: unknown) => {
        const cb = socketAck<MessageLastPreviewsPayload>(callback)
        if (!cb) return
        try {
            const dm: MessageLastPreviewsPayload["dm"] = {},
                rooms: MessageLastPreviewsPayload["rooms"] = {}
            const dmUnread: Record<string, number> = {},
                roomUnread: Record<number, number> = {}
            const dmByUserId: Record<number, import("./contracts").MessagePreviewSnippet> = {}
            const dmUnreadByUserId: Record<number, number> = {}
            const friends = await pool.query(
                `WITH peers AS (
                    SELECT u.id, COALESCE(u.guest_original_username, u.username) AS username, (u.guest_archived_at IS NOT NULL OR EXISTS (SELECT 1 FROM username_reclaims nr WHERE nr.username = u.username)) AS unsafe_legacy FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
                    WHERE (f.user_id = $1 OR f.friend_id = $1) AND f.status = 'accepted'
                 ) SELECT p.id, p.username, p.unsafe_legacy, m.content, m.sender_id, COALESCE(su.guest_original_username, su.username) AS sender_username, m.is_dm_e2ee,
                    COALESCE(m.sender_dm_public_key_at_send, su.dm_public_key) AS spk,
                    COALESCE(m.receiver_dm_public_key_at_send, ru.dm_public_key) AS rpk,
                    (SELECT COUNT(*)::int FROM messages x WHERE x.sender_id = p.id AND x.receiver_id = $1 AND x.read = FALSE) AS unread
                 FROM peers p LEFT JOIN LATERAL (
                    SELECT * FROM messages x WHERE x.room_id IS NULL AND ((x.sender_id = $1 AND x.receiver_id = p.id) OR (x.sender_id = p.id AND x.receiver_id = $1))
                    ORDER BY x.id DESC LIMIT 1
                 ) m ON TRUE LEFT JOIN users su ON su.id = m.sender_id LEFT JOIN users ru ON ru.id = m.receiver_id`,
                [user.id]
            )
            const groups = await pool.query(
                `SELECT rm.room_id, m.content, COALESCE(u.guest_original_username, u.username) AS sender_username,
                    (SELECT COUNT(*)::int FROM messages x WHERE x.room_id = rm.room_id
                        AND x.id > COALESCE(rs.last_read_message_id, 0)
                        AND x.id > GREATEST(rm.visible_after_id, COALESCE(rw.e2ee_visible_after_id, 0))) AS unread
                 FROM room_members rm LEFT JOIN room_e2ee_wraps rw ON rw.room_id = rm.room_id AND rw.user_id = rm.user_id
                 LEFT JOIN room_read_state rs ON rs.room_id = rm.room_id AND rs.user_id = rm.user_id
                 LEFT JOIN LATERAL (
                    SELECT * FROM messages x WHERE x.room_id = rm.room_id
                        AND x.id > GREATEST(rm.visible_after_id, COALESCE(rw.e2ee_visible_after_id, 0))
                    ORDER BY x.id DESC LIMIT 1
                 ) m ON TRUE LEFT JOIN users u ON u.id = m.sender_id WHERE rm.user_id = $1`,
                [user.id]
            )
            for (const row of friends.rows) {
                if (row.content != null)
                    dmByUserId[row.id] = {
                        from: row.sender_username,
                        sender_id: row.sender_id,
                        content: row.content,
                        is_dm_e2ee: row.is_dm_e2ee,
                        senderDmPublicKey: row.spk,
                        receiverDmPublicKey: row.rpk
                    }
                if (row.unread > 0) dmUnreadByUserId[row.id] = row.unread
                if (!row.unsafe_legacy) {
                    if (dmByUserId[row.id]) dm[row.username] = dmByUserId[row.id]
                    if (row.unread > 0) dmUnread[row.username] = row.unread
                }
            }
            for (const row of groups.rows) {
                if (row.content != null) rooms[row.room_id] = { from: row.sender_username, content: row.content }
                if (row.unread > 0) roomUnread[row.room_id] = row.unread
            }
            cb({ dm, rooms, roomUnread, dmUnread, dmByUserId, dmUnreadByUserId })
        } catch (error) {
            console.error("message:lastPreviews", error)
            cb({ dm: {}, rooms: {}, roomUnread: {}, dmUnread: {} })
        }
    })
}
