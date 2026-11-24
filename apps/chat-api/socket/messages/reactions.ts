import { resolvePeer, emitPeerEvent } from "../peerIdentity"
import { canSeeRoomMessage, roomMessageRecipients } from "./visibility"
import type { FeatureContext } from "../../../shared/socket/featureContext"
import { pool, parsePositiveInt } from "./helpers"
import { parseSingleReactionEmoji } from "./reactionEmoji"

export interface MessageReactPayload {
    messageId?: unknown
    emoji?: unknown
    roomId?: unknown
    username?: unknown
}

export default function registerMessageReactions({ io, socket, user }: FeatureContext): void {
    const uid = user.id
    const uname = user.username

    socket.on("message:react", async (data: MessageReactPayload) => {
        try {
            const messageId = parsePositiveInt(data?.messageId)
            const emoji = parseSingleReactionEmoji(data?.emoji)
            if (!messageId || !emoji) return

            const row = await pool.query<{
                id: number
                sender_id: number
                receiver_id: number | null
                room_id: number | null
                sender_username: string
                receiver_username: string
            }>(
                `SELECT m.id, m.sender_id, m.receiver_id, m.room_id,
                        su.username AS sender_username, ru.username AS receiver_username
                 FROM messages m
                 JOIN users su ON su.id = m.sender_id
                 LEFT JOIN users ru ON ru.id = m.receiver_id
                 WHERE m.id = $1`,
                [messageId]
            )
            if (row.rows.length === 0) return
            const m = row.rows[0]

            if (m.room_id != null) {
                const roomId = m.room_id
                const member = await pool.query("SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2", [
                    roomId,
                    uid
                ])
                if (member.rows.length === 0 || !(await canSeeRoomMessage(uid, roomId, messageId))) return
                if (parsePositiveInt(data?.roomId) !== roomId && data?.roomId != null) return

                const del = await pool.query(
                    `DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
                    [messageId, uid, emoji]
                )
                let active = false
                if ((del.rowCount ?? 0) === 0) {
                    await pool.query(`INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`, [
                        messageId,
                        uid,
                        emoji
                    ])
                    active = true
                }

                const members = { rows: await roomMessageRecipients(roomId, messageId) }
                const evt = {
                    messageId,
                    roomId,
                    userId: uid,
                    username: uname,
                    emoji,
                    active
                }
                members.rows.forEach((u) => io.to(u.user_id.toString()).emit("message:reaction", evt))
                return
            }

            if (m.receiver_id == null) return
            if (m.sender_id !== uid && m.receiver_id !== uid) return
            const peerId = m.sender_id === uid ? m.receiver_id : m.sender_id
            if (!(await resolvePeer(peerId, undefined))) return
            const dmSenderUsername = m.sender_username
            const dmReceiverUsername = m.receiver_username

            const friend = await pool.query(
                "SELECT 1 FROM friendships WHERE ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND status='accepted'",
                [uid, peerId]
            )
            if (friend.rows.length === 0) return

            const del = await pool.query(
                `DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
                [messageId, uid, emoji]
            )
            let active = false
            if ((del.rowCount ?? 0) === 0) {
                await pool.query(`INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)`, [
                    messageId,
                    uid,
                    emoji
                ])
                active = true
            }

            const evt = {
                messageId,
                sender_id: m.sender_id,
                receiver_id: m.receiver_id,
                dmSenderUsername,
                dmReceiverUsername,
                userId: uid,
                username: uname,
                emoji,
                active
            }
            await emitPeerEvent(io, peerId, [uid, peerId], "message:reaction", evt)
            await emitPeerEvent(io, uid, [uid, peerId], "message:reaction", evt)
        } catch (e) {
            console.error("message:react", e)
        }
    })
}
