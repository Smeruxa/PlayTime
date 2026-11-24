import { moveAttachmentStagingToFinal } from "../../services/attachments"
import { MEDIA_ENCRYPTION_OVERHEAD } from "../../services/mediaStorage"
import { moveVoiceStagingToFinal } from "../../services/voiceMessages"
import type { MessageSendPayload, RoomMessageReceivePayload } from "./contracts"
import type { MessageSendDatabase } from "./sendTypes"

interface VoiceUpload {
    key: string
    duration: number
}

interface AttachmentUpload {
    key: string
    mime: string
    filename: string
    size: number
}

export interface StagedMedia {
    voice: VoiceUpload | null
    attachment: AttachmentUpload | null
}

interface UploadLimits {
    maxVoiceMessageSec: number
    maxAttachmentBytes: number
}

function voiceKeyForSend(data: MessageSendPayload, maxSeconds: number): string {
    const key = typeof data.voiceKey === "string" ? data.voiceKey.trim().replace(/[^a-zA-Z0-9-]/g, "") : ""
    if (!key) return ""
    const rawDuration = data.voiceDurationSec
    const duration = typeof rawDuration === "number" ? rawDuration : parseFloat(String(rawDuration ?? ""))
    if (!Number.isFinite(duration) || duration <= 0 || duration > maxSeconds) {
        throw new Error(`Некорректная длительность голосового (макс. ${maxSeconds} с для вашего тарифа)`)
    }
    return key
}

async function findAttachment(
    db: MessageSendDatabase,
    data: MessageSendPayload,
    userId: number,
    maxBytes: number
): Promise<AttachmentUpload | null> {
    const key = typeof data.attachmentKey === "string" ? data.attachmentKey.trim() : ""
    if (!key) return null
    const { rows } = await db.query<{ mime: string; filename: string; size_bytes: number }>(
        `SELECT s.mime, s.filename, s.size_bytes FROM attachment_staging s
         JOIN media_objects o ON o.storage_key = s.attachment_key AND o.kind = 'attachment' AND o.encrypted = TRUE
         WHERE s.attachment_key = $1 AND s.user_id = $2 AND s.created_at > NOW() - INTERVAL '2 hours'
           AND o.finalized_at IS NULL
         FOR UPDATE OF o`,
        [key, userId]
    )
    const row = rows[0]
    if (!row) throw new Error("Нет загруженного файла, отправьте снова")
    if (row.size_bytes > maxBytes + MEDIA_ENCRYPTION_OVERHEAD) throw new Error("Файл больше лимита тарифа")
    return { key, mime: row.mime, filename: row.filename, size: row.size_bytes }
}

export async function readStagedMedia(
    db: MessageSendDatabase,
    data: MessageSendPayload,
    userId: number,
    limits: UploadLimits
): Promise<StagedMedia> {
    const voiceKey = voiceKeyForSend(data, limits.maxVoiceMessageSec)
    const attachment = await findAttachment(db, data, userId, limits.maxAttachmentBytes)
    let voice: VoiceUpload | null = null
    if (voiceKey) {
        const { rows } = await db.query<{ duration_sec: number }>(
            `SELECT s.duration_sec FROM voice_staging s
             JOIN media_objects o ON o.storage_key = s.voice_key AND o.kind = 'voice' AND o.encrypted = TRUE
             WHERE s.voice_key = $1 AND s.user_id = $2 AND s.created_at > NOW() - INTERVAL '2 hours'
               AND o.finalized_at IS NULL
             FOR UPDATE OF o`,
            [voiceKey, userId]
        )
        if (!rows.length) throw new Error("Нет загруженного голосового, запишите снова")
        voice = { key: voiceKey, duration: rows[0].duration_sec }
    }
    return { voice, attachment }
}

async function finalizeUpload(
    db: MessageSendDatabase,
    key: string,
    kind: "voice" | "attachment",
    context: "room" | "dm",
    messageId: number
): Promise<void> {
    try {
        if (kind === "voice") {
            await db.query("DELETE FROM voice_staging WHERE voice_key = $1", [key])
            await moveVoiceStagingToFinal(key, db)
        } else {
            await db.query("DELETE FROM attachment_staging WHERE attachment_key = $1", [key])
            await moveAttachmentStagingToFinal(key, db)
        }
    } catch (error) {
        console.error(`${kind} finalize ${context}`, error)
        await db.query("DELETE FROM messages WHERE id = $1", [messageId])
        throw new Error(kind === "voice" ? "Не удалось сохранить голосовое" : "Не удалось сохранить файл")
    }
}

export async function finalizeStagedMedia(
    db: MessageSendDatabase,
    { voice, attachment }: StagedMedia,
    context: "room" | "dm",
    messageId: number
): Promise<void> {
    if (voice) await finalizeUpload(db, voice.key, "voice", context, messageId)
    if (attachment) await finalizeUpload(db, attachment.key, "attachment", context, messageId)
}

export function outgoingMedia({
    voice,
    attachment
}: StagedMedia): Pick<
    RoomMessageReceivePayload,
    | "voiceStorageKey"
    | "voiceDurationSec"
    | "attachmentKey"
    | "attachmentMime"
    | "attachmentFilename"
    | "attachmentSize"
> {
    return {
        ...(voice && { voiceStorageKey: voice.key, voiceDurationSec: voice.duration }),
        ...(attachment && {
            attachmentKey: attachment.key,
            attachmentMime: attachment.mime,
            attachmentFilename: attachment.filename,
            attachmentSize: attachment.size
        })
    }
}
