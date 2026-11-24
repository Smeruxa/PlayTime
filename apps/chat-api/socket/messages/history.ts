import { canSeeRoomMessage } from "./visibility"
import { resolvePeer } from "../peerIdentity"
import type { FeatureContext } from "../../../shared/socket/featureContext"
import { pool, parsePositiveInt, normalizeUsername, markDmInboundReadAndNotify, bumpRoomRead } from "./helpers"
import type { MessageGetMessagesPayload } from "./contracts"

export default function registerMessageHistory({ io, socket, user }: FeatureContext): void {
    const uid = user.id
    const uname = user.username

    socket.on("message:getMessages", async (data: MessageGetMessagesPayload) => {
        const requestId =
            typeof data?.requestId === "string" && data.requestId.length <= 100 ? data.requestId : undefined
        const context = {
            requestId,
            peerUserId: data?.peerUserId,
            roomId: data?.roomId,
            username: data?.username,
            beforeId: data?.beforeId
        }
        const beforeId = parsePositiveInt(data?.beforeId) || 2147483647
        const fail = (err: string) => socket.emit("message:getMessages:error", { ...context, err })
        try {
            if (data.roomId != null) {
                const roomId = parsePositiveInt(data.roomId)
                if (!roomId) return fail("Invalid room")
                const member = await pool.query("SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2", [
                    roomId,
                    uid
                ])
                if (member.rows.length === 0) return fail("Нет доступа к комнате")
                const wmRes = await pool.query<{ wm: number }>(
                    `SELECT COALESCE(
                        (SELECT last_read_message_id FROM room_read_state WHERE room_id = $1 AND user_id = $2),
                        0
                    )::int AS wm`,
                    [roomId, uid]
                )
                const roomReadWatermark = wmRes.rows[0]?.wm ?? 0

                const pinRes = await pool.query<{ pinned_message_id: number | null }>(
                    "SELECT pinned_message_id FROM rooms WHERE id = $1",
                    [roomId]
                )
                const pinned = pinRes.rows[0]?.pinned_message_id
                const pinnedMessageId = pinned && await canSeeRoomMessage(uid, roomId, pinned) ? pinned : null

                const messagesRes = await pool.query(
                    `SELECT
                        m.id,
                        m.sender_id,
                        COALESCE(u.guest_original_username, u.username) AS sender_username,
                        (u.guest_archived_at IS NOT NULL) AS sender_archived,
                        m.content,
                        m.voice_storage_key,
                        m.voice_duration_sec,
                        m.attachment_storage_key,
                        m.attachment_mime,
                        m.attachment_filename,
                        m.attachment_size,
                        m.created_at,
                        m.edited_at,
                        m.read,
                        r.id AS reply_to_id,
                        COALESCE(ru.guest_original_username, ru.username) AS reply_sender_username,
                        CASE
                            WHEN r.content LIKE 'R2E1:%' THEN '[Защищено сквозным шифрованием]'
                            ELSE LEFT(r.content, 120)
                        END AS reply_preview,
                        m.sender_id = $1 AS me,
                        (SELECT COALESCE(json_agg(json_build_object('emoji', mr.emoji, 'by', COALESCE(u2.guest_original_username, u2.username), 'userId', u2.id) ORDER BY mr.created_at), '[]'::json)
                         FROM message_reactions mr
                         JOIN users u2 ON u2.id = mr.user_id
                         WHERE mr.message_id = m.id) AS reactions_json
                    FROM messages m
                    JOIN users u ON u.id = m.sender_id
                    JOIN room_members viewer ON viewer.room_id=m.room_id AND viewer.user_id=$1
                    LEFT JOIN room_e2ee_wraps viewer_wrap ON viewer_wrap.room_id = m.room_id AND viewer_wrap.user_id = $1
                    LEFT JOIN messages r ON r.id = m.reply_to_id AND r.room_id = m.room_id
                        AND r.id > GREATEST(viewer.visible_after_id, COALESCE(viewer_wrap.e2ee_visible_after_id, 0))
                    LEFT JOIN users ru ON ru.id = r.sender_id
                    WHERE m.room_id = $2 AND m.id < $3
                      AND m.id > GREATEST(viewer.visible_after_id, COALESCE(viewer_wrap.e2ee_visible_after_id, 0))
                    ORDER BY m.id DESC LIMIT 51`,
                    [uid, roomId, beforeId]
                )
                await bumpRoomRead(uid, roomId)
                return socket.emit("message:getMessages:success", {
                    ...context,
                    messages: messagesRes.rows.slice(0, 50).reverse(),
                    hasMore: messagesRes.rows.length > 50,
                    roomReadWatermark,
                    pinnedMessageId:
                        pinnedMessageId && messagesRes.rows.some((row) => row.id === pinnedMessageId)
                            ? pinnedMessageId
                            : null
                })
            }

            let dmUsername = normalizeUsername(data.username)
            if (!dmUsername && data.peerUserId === undefined) return fail("User not found")
            const peer = await resolvePeer(data.peerUserId, dmUsername, { allowArchived: true })
            if (!peer) return fail("User not found")
            const receiverId = peer.id
            dmUsername = peer.username

            const friend = await pool.query(
                "SELECT 1 FROM friendships WHERE ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND status='accepted'",
                [uid, receiverId]
            )
            if (friend.rows.length === 0) return fail("Нет доступа")

            await markDmInboundReadAndNotify(io, uid, uname, receiverId)

            const messagesRes = await pool.query(
                `SELECT
                    m.id,
                    m.sender_id,
                    m.receiver_id,
                    COALESCE(u1.guest_original_username, u1.username) AS sender_username,
                    COALESCE(u2.guest_original_username, u2.username) AS receiver_username,
                    m.content,
                    m.voice_storage_key,
                    m.voice_duration_sec,
                    m.attachment_storage_key,
                    m.attachment_mime,
                    m.attachment_filename,
                    m.attachment_size,
                    m.is_dm_e2ee,
                    COALESCE(m.sender_dm_public_key_at_send, u1.dm_public_key) AS sender_dm_public_key,
                    COALESCE(m.receiver_dm_public_key_at_send, u2.dm_public_key) AS receiver_dm_public_key,
                    m.created_at,
                    m.edited_at,
                    m.read,
                    m.reply_to_id,
                    COALESCE(ru.guest_original_username, ru.username) AS reply_sender_username,
                    CASE
                        WHEN r.is_dm_e2ee OR r.content LIKE 'E2E1:%' THEN '[Защищено сквозным шифрованием]'
                        WHEN r.content LIKE 'R2E1:%' THEN '[Защищено сквозным шифрованием]'
                        ELSE LEFT(r.content, 120)
                    END AS reply_preview,
                    m.sender_id = $1 AS me,
                    (SELECT COALESCE(json_agg(json_build_object('emoji', mr.emoji, 'by', COALESCE(u2.guest_original_username, u2.username), 'userId', u2.id) ORDER BY mr.created_at), '[]'::json)
                     FROM message_reactions mr
                     JOIN users u2 ON u2.id = mr.user_id
                     WHERE mr.message_id = m.id) AS reactions_json
                FROM messages m
                JOIN users u1 ON u1.id = m.sender_id
                JOIN users u2 ON u2.id = m.receiver_id
                LEFT JOIN messages r ON r.id = m.reply_to_id
                LEFT JOIN users ru ON ru.id = r.sender_id
                WHERE (m.sender_id=$1 AND m.receiver_id=$2) OR (m.sender_id=$2 AND m.receiver_id=$1)
                ORDER BY m.created_at ASC`,
                [uid, receiverId]
            )

            const low = uid < receiverId ? uid : receiverId
            const high = uid < receiverId ? receiverId : uid

            const dmPinRes = await pool.query<{ pinned_message_id: number | null }>(
                "SELECT pinned_message_id FROM dm_pinned_messages WHERE user_a_id = $1 AND user_b_id = $2",
                [low, high]
            )
            const pinnedMessageId = dmPinRes.rows[0]?.pinned_message_id ?? null

            const opsRes = await pool.query<{ id: number; body: string; created_at: Date }>(
                `SELECT id, body, created_at FROM dm_thread_operations
                 WHERE user_a_id = $1 AND user_b_id = $2
                 ORDER BY created_at DESC LIMIT 50`,
                [low, high]
            )
            const opRows = opsRes.rows.map((r) => ({
                is_dm_thread_op: true as const,
                id: -r.id,
                content: r.body,
                created_at: r.created_at,
                me: false,
                read: false
            }))
            const merged = [...messagesRes.rows, ...opRows].sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            )

            socket.emit("message:getMessages:success", {
                ...context,
                peerUserId: receiverId,
                peerArchived: Boolean(peer.guest_archived_at),
                messages: merged,
                pinnedMessageId,
                hasMore: false
            })
        } catch {
            fail("Load error")
        }
    })
}
