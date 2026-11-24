import { checkMessageKey } from "../../features/chat/peerKeyTrust"
import { DM_E2EE_PREFIX, decryptDmCiphertext, getDmSecretKey } from "../../features/chat/dmE2ee"
import { decryptRoomCiphertext, loadRoomSymKeyFromStorage, roomMessageEpoch, ROOM_E2EE_PREFIX } from "../../features/chat/roomE2ee"
import { VOICE_MESSAGE_PLAINTEXT } from "../../features/chat/voiceConstants"
import type { LastPreview } from "./types"
import { decodeMediaMessage, MEDIA_MESSAGE_PREFIX } from "../../features/chat/mediaEncryption"

const PREVIEW_CONTENT_MAX = 35

const E2EE_SIDEBAR_PLACEHOLDER = "[Защищено сквозным шифрованием]"

export type PreviewDecryptCtx =
    | { kind: "none" }
    | { kind: "room"; roomId: number }
    | {
          kind: "dm"
          myUserId: number | null
          myName: string | null
          fromUserId?: number
          fromUsername: string
          is_dm_e2ee?: boolean
          senderDmPublicKey?: string | null
          receiverDmPublicKey?: string | null
      }

export function previewDecryptPlaintext(content: string | null | undefined, ctx: PreviewDecryptCtx): string {
    const s = content ?? ""
    if (ctx.kind === "none") {
        if (s.startsWith(ROOM_E2EE_PREFIX) || s.startsWith(DM_E2EE_PREFIX)) return E2EE_SIDEBAR_PLACEHOLDER
        return s
    }
    if (ctx.kind === "room") {
        if (!s.startsWith(ROOM_E2EE_PREFIX)) return s
        const sym = loadRoomSymKeyFromStorage(ctx.roomId, roomMessageEpoch(s))
        if (!sym) return E2EE_SIDEBAR_PLACEHOLDER
        try {
            return decryptRoomCiphertext(s, sym)
        } catch {
            return "[Не удалось расшифровать]"
        }
    }
    if (!s.startsWith(DM_E2EE_PREFIX) && !ctx.is_dm_e2ee) return s
    const sk = getDmSecretKey(ctx.myUserId)
    if (!sk) return E2EE_SIDEBAR_PLACEHOLDER
    const iAmSender = ctx.fromUserId != null ? ctx.fromUserId === ctx.myUserId : ctx.fromUsername === ctx.myName
    try {
        if (!iAmSender && !checkMessageKey(ctx.fromUserId, ctx.senderDmPublicKey, ctx.fromUsername)) return E2EE_SIDEBAR_PLACEHOLDER
        return decryptDmCiphertext(s, sk, ctx.senderDmPublicKey, ctx.receiverDmPublicKey, iAmSender)
    } catch {
        return "[Не удалось расшифровать]"
    }
}

export type MessagePreviewWire = {
    sender_id?: number
    from: string
    content: string
    is_dm_e2ee?: boolean
    senderDmPublicKey?: string | null
    receiverDmPublicKey?: string | null
}

export type LastPreviewsWire = {
    dmByUserId?: Record<string, MessagePreviewWire>
    dmUnreadByUserId?: Record<string, number>
    dm: Record<string, MessagePreviewWire>
    rooms: Record<number, { from: string; content: string }>
    roomUnread?: Record<string, number>
    dmUnread?: Record<string, number>
}

export function roomUnreadFromWire(data: LastPreviewsWire): Record<number, number> {
    const out: Record<number, number> = {}
    const raw = data.roomUnread
    if (!raw || typeof raw !== "object") return out
    for (const [k, v] of Object.entries(raw)) {
        const id = Number(k)
        const n = typeof v === "number" ? v : parseInt(String(v), 10)
        if (Number.isFinite(id) && Number.isFinite(n) && n > 0) out[id] = n
    }
    return out
}

export function dmUnreadFromWire(data: LastPreviewsWire): Record<string, number> {
    const out: Record<string, number> = {}
    const raw = data.dmUnreadByUserId
    if (!raw || typeof raw !== "object") return out
    for (const [userId, v] of Object.entries(raw)) {
        if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) continue
        const n = typeof v === "number" ? v : parseInt(String(v), 10)
        if (Number.isFinite(n) && n > 0) out[userId] = n
    }
    return out
}

export function previewPlainToSidebarLabel(plain: string): string {
    if (plain.startsWith(MEDIA_MESSAGE_PREFIX)) {
        return decodeMediaMessage(plain)?.kind === "voice" ? "Голосовое сообщение" : "Вложение"
    }
    return plain === VOICE_MESSAGE_PLAINTEXT ? "Голосовое сообщение" : plain
}

export function lastPreviewsFromWire(
    data: LastPreviewsWire,
    myName: string | null,
    myUserId: number | null
): Record<string, LastPreview> {
    const next: Record<string, LastPreview> = {}
    Object.entries(data.dmByUserId || {}).forEach(([userId, v]) => {
        if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) return
        const plain = previewDecryptPlaintext(v.content, {
            kind: "dm",
            myUserId,
            myName,
            fromUserId: v.sender_id,
            fromUsername: v.from,
            is_dm_e2ee: v.is_dm_e2ee,
            senderDmPublicKey: v.senderDmPublicKey,
            receiverDmPublicKey: v.receiverDmPublicKey
        })
        next[`dm-${userId}`] = { from: v.from, content: truncateMessagePreview(previewPlainToSidebarLabel(plain)) }
    })
    Object.entries(data.rooms || {}).forEach(([roomIdStr, v]) => {
        const roomId = Number(roomIdStr)
        const plain = previewDecryptPlaintext(v.content, { kind: "room", roomId })
        next[`room-${roomId}`] = { from: v.from, content: truncateMessagePreview(previewPlainToSidebarLabel(plain)) }
    })
    return next
}

export function truncateMessagePreview(s: string): string {
    return s.length > PREVIEW_CONTENT_MAX ? s.slice(0, PREVIEW_CONTENT_MAX - 1) + "…" : s
}

export { PREVIEW_CONTENT_MAX }
