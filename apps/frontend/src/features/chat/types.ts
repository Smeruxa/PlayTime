import type { MediaDescriptor } from "./mediaEncryption"
import type { DirectCallState } from "../../utils/directCallState"

export type MessageReplyRef = {
    id: number
    author: string
    preview: string
}

export type MessageReactionGroup = {
    emoji: string
    users: string[]
}

export type DisplayMessage = {
    id: number
    me: boolean
    text: string
    data: number
    read?: boolean
    from?: string
    reply?: MessageReplyRef | null
    editedAt?: number | null
    reactions?: MessageReactionGroup[]
    voice?: { key: string; durationSec: number; media?: MediaDescriptor }
    attachment?: { key: string; mime: string; filename: string; sizeBytes: number; media?: MediaDescriptor }
    isThreadOp?: boolean
    clientMessageId?: string
    delivery?: { status: "sending" | "sent" | "failed"; error?: string }
}

export type StartCallResponse = {
    state?: DirectCallState | null
    confirmed?: boolean
    success?: boolean
    roomId?: string
    err?: string
}
