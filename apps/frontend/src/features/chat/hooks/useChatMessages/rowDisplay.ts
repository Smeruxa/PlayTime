import type { MessageReplyWire } from "../../../../types"
import type { DisplayMessage, MessageReplyRef } from "../../types"
import { reactionsFromHistoryField } from "../../reactionAggregate"
import { checkMessageKey } from "../../peerKeyTrust"
import { decryptDmCiphertext, getDmSecretKey } from "../../dmE2ee"
import { decryptRoomCiphertext, ROOM_E2EE_PREFIX } from "../../roomE2ee"
import type { HistoryRow } from "./types"
import { VOICE_MESSAGE_LIST_LABEL } from "../../voiceConstants"
import { ATTACHMENT_MESSAGE_LIST_LABEL } from "../../attachmentConstants"
import { decodeMediaMessage, MEDIA_MESSAGE_PREFIX } from "../../mediaEncryption"

export function displayMedia(
    plaintext: string,
    voice?: DisplayMessage["voice"],
    attachment?: DisplayMessage["attachment"]
): Pick<DisplayMessage, "text" | "voice" | "attachment"> {
    const descriptor = decodeMediaMessage(plaintext)
    if (descriptor?.kind === "voice" && descriptor.storageKey === voice?.key) {
        return {
            text: VOICE_MESSAGE_LIST_LABEL,
            voice: { key: voice.key, durationSec: descriptor.durationSec!, media: descriptor }
        }
    }
    if (descriptor?.kind === "attachment" && descriptor.storageKey === attachment?.key) {
        return {
            text: ATTACHMENT_MESSAGE_LIST_LABEL,
            attachment: {
                key: attachment.key,
                mime: descriptor.mime,
                filename: descriptor.filename,
                sizeBytes: descriptor.sizeBytes,
                media: descriptor
            }
        }
    }
    if (plaintext.startsWith(MEDIA_MESSAGE_PREFIX)) return { text: "[Не удалось расшифровать вложение]" }
    return {
        text: voice ? VOICE_MESSAGE_LIST_LABEL : attachment ? ATTACHMENT_MESSAGE_LIST_LABEL : plaintext,
        voice,
        attachment
    }
}

function parseAttachmentRow(m: HistoryRow) {
    const key = m.attachment_storage_key
    if (typeof key !== "string" || !key.length) return undefined
    const mime = typeof m.attachment_mime === "string" ? m.attachment_mime : "application/octet-stream"
    const filename = typeof m.attachment_filename === "string" ? m.attachment_filename : "file"
    const size = typeof m.attachment_size === "number" && Number.isFinite(m.attachment_size) ? m.attachment_size : 0
    return { key, mime, filename, sizeBytes: size }
}

export function parseLiveAttachment(msg: {
    attachmentKey?: string | null
    attachmentMime?: string | null
    attachmentFilename?: string | null
    attachmentSize?: number | null
}) {
    const key = msg.attachmentKey
    if (typeof key !== "string" || !key.length) return undefined
    const mime = typeof msg.attachmentMime === "string" ? msg.attachmentMime : "application/octet-stream"
    const filename = typeof msg.attachmentFilename === "string" ? msg.attachmentFilename : "file"
    const size = typeof msg.attachmentSize === "number" && Number.isFinite(msg.attachmentSize) ? msg.attachmentSize : 0
    return { key, mime, filename, sizeBytes: size }
}

export function normalizeOutgoingContent(raw: string): string | null {
    const s = raw.replace(/\r\n/g, "\n")
    if (!s.trim()) return null
    return s
}

export function wireToReplyRef(r: MessageReplyWire | null | undefined): MessageReplyRef | null {
    if (!r) return null
    return { id: r.id, author: r.from, preview: r.preview }
}

function rowReply(m: HistoryRow): MessageReplyRef | null {
    if (!m.reply_to_id) return null
    return {
        id: m.reply_to_id,
        author: m.reply_sender_username || "",
        preview: m.reply_preview || ""
    }
}

function decryptDmRow(m: HistoryRow, myUserId: number | null): string {
    if (!m.is_dm_e2ee) return m.content
    const sk = getDmSecretKey(myUserId)
    if (!sk) return "🔒 Защищено сквозным шифрованием"
    try {
        if (!m.me && !checkMessageKey(m.sender_id, m.sender_dm_public_key, m.sender_username, true)) return "[Требуется проверка ключа собеседника]"
        return decryptDmCiphertext(m.content, sk, m.sender_dm_public_key, m.receiver_dm_public_key, !!m.me)
    } catch {
        return "[Не удалось расшифровать]"
    }
}

function decryptRoomRow(m: HistoryRow, symKey: Uint8Array | null): string {
    if (!symKey) return m.content.startsWith(ROOM_E2EE_PREFIX) ? "🔒 Защищено сквозным шифрованием" : m.content
    try {
        return decryptRoomCiphertext(m.content, symKey)
    } catch {
        return "[Не удалось расшифровать]"
    }
}

export function rowToDisplay(
    m: HistoryRow,
    is_room: boolean,
    myName: string | null,
    roomSymKey: Uint8Array | null,
    myUserId: number | null
): DisplayMessage {
    if (m.is_dm_thread_op) {
        return {
            id: m.id,
            me: false,
            text: m.content,
            data: new Date(m.created_at).getTime(),
            isThreadOp: true
        }
    }
    const reply = rowReply(m)
    const decrypted = is_room ? decryptRoomRow(m, roomSymKey) : decryptDmRow(m, myUserId)
    const vk = m.voice_storage_key
    const vd = m.voice_duration_sec
    const hasVoice = typeof vk === "string" && vk.length > 0
    const attachment = parseAttachmentRow(m)
    const voice = hasVoice
        ? { key: vk as string, durationSec: typeof vd === "number" && Number.isFinite(vd) ? vd : 0 }
        : undefined
    const rx = reactionsFromHistoryField(m.reactions_json)
    return {
        id: m.id,
        me: is_room ? (m.sender_id !== undefined ? m.sender_id === myUserId : m.sender_username === myName) : !!m.me,
        ...displayMedia(decrypted, voice, attachment),
        data: new Date(m.created_at).getTime(),
        read: is_room ? false : !!m.read,
        editedAt: m.edited_at ? new Date(m.edited_at).getTime() : null,
        ...(reply ? { reply } : {}),
        ...(is_room && m.sender_username
            ? { from: m.sender_archived ? `${m.sender_username} · Гость вышел` : m.sender_username }
            : {}),
        ...(rx.length > 0 ? { reactions: rx } : {})
    }
}

export function decryptLiveDm(
    content: string,
    isE2ee: boolean | undefined,
    senderDmPublicKey: string | null | undefined,
    receiverDmPublicKey: string | null | undefined,
    senderUsername: string | undefined,
    myName: string | null,
    myUserId: number | null,
    senderId?: number
): string {
    if (!isE2ee) return content
    const sk = getDmSecretKey(myUserId)
    if (!sk) return "🔒 Защищено сквозным шифрованием"
    const iAmSender = senderId !== undefined ? senderId === myUserId : senderUsername === myName
    try {
        if (!iAmSender && !checkMessageKey(senderId, senderDmPublicKey, senderUsername)) return "[Требуется проверка ключа собеседника]"
        return decryptDmCiphertext(content, sk, senderDmPublicKey, receiverDmPublicKey, iAmSender)
    } catch {
        return "[Не удалось расшифровать]"
    }
}
