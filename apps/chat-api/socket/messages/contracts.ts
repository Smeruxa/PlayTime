import type { ReplyPayload } from "./helpers"

export interface MessageSendPayload {
    clientMessageId?: unknown
    message?: unknown
    content?: unknown
    roomId?: unknown
    peerUserId?: unknown
    username?: unknown
    replyToId?: unknown
    voiceKey?: unknown
    voiceDurationSec?: unknown
    attachmentKey?: unknown
    attachmentMime?: unknown
    attachmentFilename?: unknown
    attachmentSize?: unknown
}

export interface MessageGetMessagesPayload {
    requestId?: unknown
    beforeId?: unknown
    roomId?: unknown
    peerUserId?: unknown
    username?: unknown
}

export interface MessageLastPreviewsPayload {
    dmByUserId?: Record<number, MessagePreviewSnippet>
    dmUnreadByUserId?: Record<number, number>
    dm: Record<string, MessagePreviewSnippet>
    rooms: Record<number, MessagePreviewSnippet>
    roomUnread: Record<number, number>
    dmUnread: Record<string, number>
}

export interface MessagePreviewSnippet {
    sender_id?: number
    from: string
    content: string
    is_dm_e2ee?: boolean
    senderDmPublicKey?: string | null
    receiverDmPublicKey?: string | null
}

export interface RoomMessageReceivePayload {
    sender_id: number
    userId: number
    roomId: number
    roomName: string
    from: string
    content: string
    room: true
    id: number
    created_at: Date
    read: boolean
    reply: ReplyPayload | null
    fromSelf?: true
    voiceStorageKey?: string | null
    voiceDurationSec?: number | null
    attachmentKey?: string | null
    attachmentMime?: string | null
    attachmentFilename?: string | null
    attachmentSize?: number | null
}
