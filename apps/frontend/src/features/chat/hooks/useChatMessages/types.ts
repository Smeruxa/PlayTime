import type { MessageReplyWire } from "../../../../types"
import type { MediaDescriptor } from "../../mediaEncryption"

export type VoiceSendMeta = { voiceKey: string; voiceDurationSec: number; media: MediaDescriptor }

export type AttachmentSendMeta = {
    attachmentKey: string
    attachmentMime: string
    attachmentFilename: string
    attachmentSize: number
    media: MediaDescriptor
}

export type HistoryRow = {
    sender_archived?: boolean
    sender_id?: number
    receiver_id?: number
    id: number
    sender_username?: string
    me?: boolean
    is_dm_thread_op?: boolean
    content: string
    created_at: string
    read?: boolean
    reply_to_id?: number | null
    reply_sender_username?: string | null
    reply_preview?: string | null
    is_dm_e2ee?: boolean
    sender_dm_public_key?: string | null
    receiver_dm_public_key?: string | null
    edited_at?: string | null
    reactions_json?: unknown
    voice_storage_key?: string | null
    voice_duration_sec?: number | null
    attachment_storage_key?: string | null
    attachment_mime?: string | null
    attachment_filename?: string | null
    attachment_size?: number | null
}

export type LiveReceiveMessage = {
    sender_id?: number
    receiver_id?: number
    roomId?: number
    from?: string
    sender_username?: string
    receiver_username?: string
    content: string
    created_at?: string
    id?: number
    read?: boolean
    reply?: MessageReplyWire | null
    is_dm_e2ee?: boolean
    senderDmPublicKey?: string | null
    receiverDmPublicKey?: string | null
    voiceStorageKey?: string | null
    voiceDurationSec?: number | null
    attachmentKey?: string | null
    attachmentMime?: string | null
    attachmentFilename?: string | null
    attachmentSize?: number | null
}
