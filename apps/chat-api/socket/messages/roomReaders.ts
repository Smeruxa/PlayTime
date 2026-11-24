import { canSeeRoomMessage, roomMessageRecipients } from "./visibility"
import type { FeatureContext } from "../../../shared/socket/featureContext"
import { pool, parsePositiveInt } from "./helpers"
import { socketAck } from "../../../shared/types/socket/ack"

export interface MessageGetRoomReadersPayload {
    roomId?: unknown
    messageId?: unknown
}

export interface MessageGetRoomReadersAck {
    err?: string
    readers?: string[]
}

export default function registerMessageRoomReaders({ socket, user }: FeatureContext): void {
    const uid = user.id

    socket.on("message:getRoomReaders", async (data: MessageGetRoomReadersPayload, callback: unknown) => {
        const cb = socketAck<MessageGetRoomReadersAck>(callback)
        if (!cb) return
        try {
            const roomId = parsePositiveInt(data?.roomId)
            const messageId = parsePositiveInt(data?.messageId)
            if (!roomId || !messageId) return cb({ err: "Некорректные данные" })
            const member = await pool.query("SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2", [
                roomId,
                uid
            ])
            if (member.rows.length === 0 || !await canSeeRoomMessage(uid, roomId, messageId)) return cb({ err: "Нет доступа" })
            const msg = await pool.query("SELECT id FROM messages WHERE id = $1 AND room_id = $2", [messageId, roomId])
            if (msg.rows.length === 0) return cb({ err: "Сообщение не найдено" })
            const r = await pool.query<{ username: string }>(
                `SELECT u.username
                 FROM room_read_state s
                 JOIN users u ON u.id = s.user_id
                 JOIN room_members rm ON rm.user_id = s.user_id AND rm.room_id = s.room_id
                 JOIN room_e2ee_wraps rw ON rw.user_id = s.user_id AND rw.room_id = s.room_id
                 WHERE s.room_id = $1 AND s.last_read_message_id >= $2 AND $2 > rw.e2ee_visible_after_id
                 ORDER BY u.username ASC`,
                [roomId, messageId]
            )
            cb({ readers: r.rows.map((x) => x.username) })
        } catch (e) {
            console.error("message:getRoomReaders", e)
            cb({ err: "Ошибка", readers: [] })
        }
    })
}
