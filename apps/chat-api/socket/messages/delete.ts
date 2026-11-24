import { emitPeerEvent } from "../peerIdentity"
import { roomMessageRecipients } from "./visibility"
import type { FeatureContext } from "../../../shared/socket/featureContext"
import { pool, parsePositiveInt } from "./helpers"
import { removeMediaObject } from "../../services/mediaStorage"

export interface MessageDeletePayload {
    id?: unknown
}

export default function registerMessageDelete({ io, socket, user }: FeatureContext): void {
    const uid = user.id

    socket.on("message:delete", async (data: MessageDeletePayload) => {
        try {
            const messageId = parsePositiveInt(data?.id)
            if (!messageId) return
            const row = await pool.query<{
                sender_id: number
                receiver_id: number
                room_id: number | null
                attachment_storage_key: string | null
                voice_storage_key: string | null
            }>(
                `SELECT id, sender_id, receiver_id, room_id, attachment_storage_key, voice_storage_key FROM messages WHERE id = $1`,
                [messageId]
            )
            if (row.rows.length === 0) return
            const m = row.rows[0]
            if (m.sender_id !== uid) return

            if (m.room_id != null) {
                const member = await pool.query("SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2", [
                    m.room_id,
                    uid
                ])
                if (member.rows.length === 0) return
                const recipients = await roomMessageRecipients(m.room_id, messageId)
                await pool.query("DELETE FROM messages WHERE id = $1", [messageId])
                if (m.attachment_storage_key) await removeMediaObject("attachment", m.attachment_storage_key)
                if (m.voice_storage_key) await removeMediaObject("voice", m.voice_storage_key)
                recipients.forEach((u) => {
                    io.to(u.user_id.toString()).emit("message:deleted", { id: messageId, roomId: m.room_id })
                })
                return
            }

            await pool.query("DELETE FROM messages WHERE id = $1", [messageId])
            if (m.attachment_storage_key) await removeMediaObject("attachment", m.attachment_storage_key)
            if (m.voice_storage_key) await removeMediaObject("voice", m.voice_storage_key)
            const otherId = m.receiver_id === uid ? m.sender_id : m.receiver_id
            await emitPeerEvent(io, otherId, [uid, otherId], "message:deleted", {
                id: messageId,
                sender_id: m.sender_id,
                receiver_id: m.receiver_id
            })
            await emitPeerEvent(io, uid, [uid, otherId], "message:deleted", {
                id: messageId,
                sender_id: m.sender_id,
                receiver_id: m.receiver_id
            })
        } catch (e) {
            console.error("message:delete", e)
        }
    })
}
