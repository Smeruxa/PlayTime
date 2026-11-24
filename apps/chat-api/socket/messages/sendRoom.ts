import { enqueuePush } from "../../../database/pushOutbox"
import { getLimitsForUser } from "../../../database/subscriptionPlans"
import type { RowMessageIdCreated, RowRoomName } from "../../../shared/types/db"
import { isValidRoomE2eeEnvelope } from "../../utils/roomE2eeEnvelope"
import type { RoomMessageReceivePayload } from "./contracts"
import { buildReplyPayload, loadMessageRowForEmit, parsePositiveInt } from "./helpers"
import { emitStoredMessage } from "./messageDelivery"
import { finalizeStagedMedia, outgoingMedia, readStagedMedia } from "./sendMedia"
import type { MessageSendDatabase, MessageToSend, SavedMessage } from "./sendTypes"
import { canSeeRoomMessage, roomMessageRecipients } from "./visibility"

async function visibleReply(
    db: MessageSendDatabase,
    roomId: number,
    userId: number,
    replyId: number | null
): Promise<number | null> {
    if (!replyId) return null
    const { rows } = await db.query("SELECT 1 FROM messages WHERE id = $1 AND room_id = $2", [replyId, roomId])
    return rows.length && (await canSeeRoomMessage(userId, roomId, replyId, db)) ? replyId : null
}

export async function saveRoomMessage({ db, user, data, content, replyToId }: MessageToSend): Promise<SavedMessage> {
    if (!isValidRoomE2eeEnvelope(content)) throw new Error("Некорректное зашифрованное сообщение комнаты")
    const roomId = parsePositiveInt(data.roomId)
    if (!roomId) throw new Error("Invalid room")
    const member = await db.query("SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2", [roomId, user.id])
    if (!member.rows.length) throw new Error("Нет доступа к комнате")

    const { limits } = await getLimitsForUser(user.id, db)
    const replyId = await visibleReply(db, roomId, user.id, replyToId)
    const media = await readStagedMedia(db, data, user.id, limits)
    const { voice, attachment } = media
    const {
        rows: [message]
    } = await db.query<RowMessageIdCreated>(
        `INSERT INTO messages (sender_id, room_id, content, reply_to_id, voice_storage_key, voice_duration_sec, attachment_storage_key, attachment_mime, attachment_filename, attachment_size)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, created_at`,
        [
            user.id,
            roomId,
            content,
            replyId,
            voice?.key ?? null,
            voice?.duration ?? null,
            attachment?.key ?? null,
            attachment?.mime ?? null,
            attachment?.filename ?? null,
            attachment?.size ?? null
        ]
    )

    await finalizeStagedMedia(db, media, "room", message.id)
    const full = await loadMessageRowForEmit(message.id, db)
    if (!full) throw new Error("Сообщение не сохранено")
    const reply = buildReplyPayload(full.reply_to_id, full.reply_from, full.reply_preview)
    const recipients = await roomMessageRecipients(roomId, message.id, db)
    const { rows } = await db.query<RowRoomName>("SELECT name FROM rooms WHERE id = $1", [roomId])
    const roomName = rows[0]?.name ?? ""
    const base: RoomMessageReceivePayload = {
        roomId,
        roomName,
        sender_id: user.id,
        userId: user.id,
        from: user.username,
        content,
        room: true,
        id: message.id,
        created_at: message.created_at,
        read: false,
        reply: null,
        ...outgoingMedia(media)
    }
    const deliveries = recipients.map(({ user_id, e2ee_visible_after_id }) => ({
        userId: user_id,
        payload: {
            ...base,
            reply: reply && reply.id > e2ee_visible_after_id ? reply : null,
            ...(user_id === user.id ? { fromSelf: true as const } : {})
        }
    }))
    await enqueuePush(
        {
            eventKey: `m:${message.id}`,
            chatKey: `room:${roomId}`,
            senderId: user.id,
            recipients: recipients.map((recipient) => recipient.user_id),
            roomId,
            messageId: message.id,
            target: { version: 1, userId: 0, kind: "chat", id: roomId, isRoom: true, name: roomName },
            title: roomName,
            expiresAt: Date.now() + 24 * 60 * 60 * 1000
        },
        db
    )
    return {
        id: message.id,
        async deliver({ io }) {
            await Promise.all(deliveries.map(({ userId, payload }) => emitStoredMessage(io.to(String(userId)), payload)))
        }
    }
}
