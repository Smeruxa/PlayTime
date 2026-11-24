import { resolvePeer, emitPeerEvent } from "../peerIdentity"
import type { FeatureContext } from "../../../shared/socket/featureContext"
import { pool, parsePositiveInt, normalizeUsername } from "./helpers"
import type { RowRoomMemberUserId } from "../../../shared/types/db"
import { isValidDmE2eeEnvelope } from "../../utils/dmE2eeEnvelope"
import { isValidRoomE2eeEnvelope } from "../../utils/roomE2eeEnvelope"

export interface MessageEditPayload {
    id?: unknown
    content?: unknown
    roomId?: unknown
    peerUserId?: unknown
    username?: unknown
}

export default function registerMessageEdit({ io, socket, user }: FeatureContext): void {
    const uid = user.id

    socket.on("message:edit", async (data: MessageEditPayload) => {
        try {
            const messageId = parsePositiveInt(data?.id)
            const content = typeof data?.content === "string" ? data.content : ""
            if (!messageId || !content) return

            if (data.roomId != null) {
                if (!isValidRoomE2eeEnvelope(content)) return
                const roomId = parsePositiveInt(data.roomId)
                if (!roomId) return
                const member = await pool.query("SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2", [
                    roomId,
                    uid
                ])
                if (member.rows.length === 0) return

                const up = await pool.query<{ edited_at: Date }>(
                    `UPDATE messages SET content = $1, edited_at = NOW()
                     WHERE id = $2 AND sender_id = $3 AND room_id = $4
                       AND EXISTS (SELECT 1 FROM room_members m LEFT JOIN room_e2ee_wraps w
                           ON w.room_id=m.room_id AND w.user_id=m.user_id
                           WHERE m.room_id=$4 AND m.user_id=$3 AND $2 > GREATEST(m.visible_after_id, COALESCE(w.e2ee_visible_after_id, 0)))
                     RETURNING edited_at`,
                    [content, messageId, uid, roomId]
                )
                if (up.rows.length === 0) return
                const edited_at = up.rows[0].edited_at

                const recipients = await pool.query<RowRoomMemberUserId>(
                    `SELECT rm.user_id
                     FROM room_members rm
                     INNER JOIN room_e2ee_wraps rw ON rw.room_id = rm.room_id AND rw.user_id = rm.user_id
                     WHERE rm.room_id = $1 AND $2 > GREATEST(rm.visible_after_id, rw.e2ee_visible_after_id)`,
                    [roomId, messageId]
                )
                recipients.rows.forEach((m) => {
                    io.to(m.user_id.toString()).emit("message:edited", {
                        roomId,
                        id: messageId,
                        content,
                        edited_at
                    })
                })
                return
            }

            let dmUsername = normalizeUsername(data.username)
            if (!dmUsername && data.peerUserId === undefined) return
            if (!isValidDmE2eeEnvelope(content)) return

            const peer = await resolvePeer(data.peerUserId, dmUsername, {})
            if (!peer) return
            const receiverId = peer.id
            dmUsername = peer.username

            const friend = await pool.query(
                "SELECT 1 FROM friendships WHERE ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND status='accepted'",
                [uid, receiverId]
            )
            if (friend.rows.length === 0) return

            const up = await pool.query<{ edited_at: Date }>(
                `UPDATE messages SET content = $1, edited_at = NOW(),
                    sender_dm_public_key_at_send = (SELECT dm_public_key FROM users WHERE id = $3),
                    receiver_dm_public_key_at_send = (SELECT dm_public_key FROM users WHERE id = $4)
                 WHERE id = $2 AND sender_id = $3 AND receiver_id = $4 AND room_id IS NULL
                 RETURNING edited_at`,
                [content, messageId, uid, receiverId]
            )
            if (up.rows.length === 0) return
            const edited_at = up.rows[0].edited_at

            const pkRow = await pool.query<{ spk: string | null; rpk: string | null }>(
                `SELECT us.dm_public_key AS spk, ur.dm_public_key AS rpk
                 FROM users us, users ur
                 WHERE us.id = $1 AND ur.id = $2`,
                [uid, receiverId]
            )
            const senderDmPublicKey = pkRow.rows[0]?.spk ?? null
            const receiverDmPublicKey = pkRow.rows[0]?.rpk ?? null

            const payload = {
                id: messageId,
                content,
                edited_at,
                sender_id: uid,
                receiver_id: receiverId,
                sender_username: user.username,
                receiver_username: dmUsername,
                is_dm_e2ee: true,
                senderDmPublicKey,
                receiverDmPublicKey
            }
            await emitPeerEvent(io, receiverId, [uid, receiverId], "message:edited", payload)
            await emitPeerEvent(io, uid, [uid, receiverId], "message:edited", payload)
        } catch (e) {
            console.error("message:edit", e)
        }
    })
}
