import { enqueuePush } from "../../../database/pushOutbox"
import { getLimitsForUser } from "../../../database/subscriptionPlans"
import type { RowMessageIdCreated, RowUserId } from "../../../shared/types/db"
import { isValidDmE2eeEnvelope } from "../../utils/dmE2eeEnvelope"
import { peerEventRoom, resolvePeer } from "../peerIdentity"
import { buildReplyPayload, loadMessageRowForEmit, normalizeUsername } from "./helpers"
import { emitStoredMessage } from "./messageDelivery"
import { finalizeStagedMedia, outgoingMedia, readStagedMedia } from "./sendMedia"
import type { MessageSendDatabase, MessageToSend, SavedMessage } from "./sendTypes"

async function directReply(
    db: MessageSendDatabase,
    senderId: number,
    receiverId: number,
    replyId: number | null
): Promise<number | null> {
    if (!replyId) return null
    const { rows } = await db.query(
        "SELECT 1 FROM messages WHERE id = $1 AND ((sender_id = $2 AND receiver_id = $3) OR (sender_id = $3 AND receiver_id = $2))",
        [replyId, senderId, receiverId]
    )
    return rows.length ? replyId : null
}

async function trimHistory(db: MessageSendDatabase, senderId: number, receiverId: number): Promise<void> {
    const { rows } = await db.query<RowUserId>(
        "SELECT id FROM messages WHERE (sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1) ORDER BY created_at ASC",
        [senderId, receiverId]
    )
    if (rows.length <= 40) return
    const idsToDelete = rows.slice(0, rows.length - 40).map(({ id }) => id)
    await db.query("DELETE FROM messages WHERE id = ANY($1::int[])", [idsToDelete])
}

export async function saveDirectMessage({ db, user, data, content, replyToId }: MessageToSend): Promise<SavedMessage> {
    const nickname = normalizeUsername(data.username)
    if (!nickname && data.peerUserId === undefined) throw new Error("User not found")
    const peer = await resolvePeer(data.peerUserId, nickname, { db })
    if (!peer) throw new Error("User not found")
    const receiverId = peer.id
    const friend = await db.query(
        "SELECT 1 FROM friendships WHERE ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND status='accepted' AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1))",
        [user.id, receiverId]
    )
    if (!friend.rows.length) throw new Error("User not a friend")

    const { limits } = await getLimitsForUser(user.id, db)
    if (!isValidDmE2eeEnvelope(content)) throw new Error("Некорректное зашифрованное сообщение")
    const {
        rows: [keys]
    } = await db.query<{ sid: number; spk: string | null; rpk: string | null }>(
        `SELECT $1::int AS sid, us.dm_public_key AS spk, ur.dm_public_key AS rpk
         FROM users us, users ur
         WHERE us.id = $1 AND ur.id = $2`,
        [user.id, receiverId]
    )
    if (!keys?.spk || !keys.rpk) {
        throw new Error("Оба пользователя должны опубликовать ключ шифрования (откройте приложение после входа)")
    }
    const { spk: senderDmPublicKey, rpk: receiverDmPublicKey } = keys
    const recipientRoom = await peerEventRoom(receiverId, [user.id, receiverId], db)
    const replyId = await directReply(db, user.id, receiverId, replyToId)
    const media = await readStagedMedia(db, data, user.id, limits)
    const { voice, attachment } = media
    const {
        rows: [message]
    } = await db.query<RowMessageIdCreated>(
        `INSERT INTO messages (sender_id, receiver_id, content, created_at, read, reply_to_id, is_dm_e2ee, voice_storage_key, voice_duration_sec, attachment_storage_key, attachment_mime, attachment_filename, attachment_size, sender_dm_public_key_at_send, receiver_dm_public_key_at_send)
         VALUES ($1, $2, $3, NOW(), false, $4, true, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id, created_at`,
        [
            user.id,
            receiverId,
            content,
            replyId,
            voice?.key ?? null,
            voice?.duration ?? null,
            attachment?.key ?? null,
            attachment?.mime ?? null,
            attachment?.filename ?? null,
            attachment?.size ?? null,
            senderDmPublicKey,
            receiverDmPublicKey
        ]
    )

    await trimHistory(db, user.id, receiverId)
    await finalizeStagedMedia(db, media, "dm", message.id)
    const full = await loadMessageRowForEmit(message.id, db)
    if (!full) throw new Error("Сообщение не сохранено")
    const messagePayload = {
        id: message.id,
        sender_id: user.id,
        receiver_id: receiverId,
        sender_username: user.username,
        receiver_username: peer.username,
        content,
        created_at: message.created_at,
        read: false,
        reply: buildReplyPayload(full.reply_to_id, full.reply_from, full.reply_preview),
        is_dm_e2ee: true,
        senderDmPublicKey,
        receiverDmPublicKey,
        ...outgoingMedia(media)
    }
    await enqueuePush(
        {
            eventKey: `m:${message.id}`,
            chatKey: `dm:${user.username}`,
            senderId: user.id,
            recipients: [receiverId],
            messageId: message.id,
            target: { version: 1, userId: receiverId, kind: "chat", id: user.id, isRoom: false, name: user.username },
            title: user.username,
            expiresAt: Date.now() + 24 * 60 * 60 * 1000
        },
        db
    )
    return {
        id: message.id,
        async deliver({ io, socket }) {
            await emitStoredMessage(io.to(recipientRoom), messagePayload)
            socket.emit("message:send:success", { ...messagePayload, me: true })
        }
    }
}
