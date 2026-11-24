import type { ChatRef, Message } from '../types';
import {
    DM_PREFIX,
    ROOM_PREFIX,
    MEDIA_PREFIX,
    LOCKED_MESSAGE,
    decryptDm,
    decryptRoom,
    parseMedia,
} from './crypto';

export type WireMessage = {
    id: number;
    content: string;
    created_at?: string;
    edited_at?: string | null;
    me?: boolean;
    sender_id?: number;
    receiver_id?: number;
    sender_username?: string;
    receiver_username?: string;
    from?: string;
    roomId?: number;
    read?: boolean;
    is_dm_thread_op?: boolean;
    is_dm_e2ee?: boolean;
    sender_dm_public_key?: string | null;
    receiver_dm_public_key?: string | null;
    senderDmPublicKey?: string | null;
    receiverDmPublicKey?: string | null;
    reply_to_id?: number | null;
    reply_sender_username?: string | null;
    reply_preview?: string | null;
    reply?: { id: number; from: string; preview: string } | null;
    reactions_json?: unknown;
    voice_storage_key?: string | null;
    voice_duration_sec?: number | null;
    voiceStorageKey?: string | null;
    voiceDurationSec?: number | null;
    attachment_storage_key?: string | null;
    attachment_mime?: string | null;
    attachment_filename?: string | null;
    attachment_size?: number | null;
    attachmentKey?: string | null;
    attachmentMime?: string | null;
    attachmentFilename?: string | null;
    attachmentSize?: number | null;
};

export function messageFromWire(
    wire: WireMessage,
    chat: ChatRef,
    username: string,
    dmSecret?: string,
    roomSecret?: string,
    purpose: 'message' | 'preview' = 'message',
): Message {
    const from = wire.sender_username ?? wire.from ?? '';
    const me = wire.me ?? from === username;
    let content = wire.content;
    let decryptError = false;
    const encrypted = content.startsWith(DM_PREFIX) || content.startsWith(ROOM_PREFIX);
    try {
        if (content.startsWith(DM_PREFIX)) {
            const peerKey = me
                ? wire.receiverDmPublicKey ?? wire.receiver_dm_public_key
                : wire.senderDmPublicKey ?? wire.sender_dm_public_key;
            if (!peerKey || !dmSecret) {
                throw new Error('missing-key');
            }
            content = decryptDm(content, peerKey, dmSecret);
        } else if (content.startsWith(ROOM_PREFIX)) {
            if (!roomSecret) {
                throw new Error('missing-key');
            }
            content = decryptRoom(content, roomSecret);
        }
    } catch {
        content = LOCKED_MESSAGE;
        decryptError = true;
    }
    const timestamp = wire.created_at ? Date.parse(wire.created_at) : Date.now();
    const reactions: Message['reactions'] = [];
    if (Array.isArray(wire.reactions_json)) {
        for (const reaction of wire.reactions_json) {
            if (
                !reaction ||
                typeof reaction.emoji !== 'string' ||
                typeof reaction.by !== 'string'
            ) {
                continue;
            }
            const existing = reactions.find((r) => r.emoji === reaction.emoji);
            if (existing) {
                if (!existing.users.includes(reaction.by)) {
                    existing.users.push(reaction.by);
                }
            } else {
                reactions.push({ emoji: reaction.emoji, users: [reaction.by] });
            }
        }
    }
    const result: Message = {
        id: wire.id,
        text: content,
        data: Number.isFinite(timestamp) ? timestamp : Date.now(),
        me,
        from,
        read: !!wire.read,
        encrypted,
        decryptError,
        reactions,
        editedAt: wire.edited_at ? Date.parse(wire.edited_at) : null,
        isThreadOp: !!wire.is_dm_thread_op,
        reply: wire.reply
            ? { id: wire.reply.id, author: wire.reply.from, preview: wire.reply.preview }
            : wire.reply_to_id
            ? {
                  id: wire.reply_to_id,
                  author: wire.reply_sender_username ?? '',
                  preview: wire.reply_preview ?? '',
              }
            : null,
    };
    const voiceKey = wire.voiceStorageKey ?? wire.voice_storage_key;
    const attachmentKey = wire.attachmentKey ?? wire.attachment_storage_key;
    const media = parseMedia(content);
    if (purpose === 'preview' && media) {
        result.text = media.kind === 'voice' ? 'Голосовое сообщение' : media.filename;
        return result;
    }
    if (
        media &&
        ((media.kind === 'voice' && media.storageKey === voiceKey) ||
            (media.kind === 'attachment' && media.storageKey === attachmentKey))
    ) {
        result.media = media;
        if (media.kind === 'voice') {
            result.text = 'Голосовое сообщение';
            result.voice = { key: media.storageKey, durationSec: media.durationSec!, media };
        } else {
            result.text = media.filename;
            result.attachment = {
                key: media.storageKey,
                mime: media.mime,
                filename: media.filename,
                sizeBytes: media.sizeBytes,
                media,
            };
        }
    } else if (content.startsWith(MEDIA_PREFIX)) {
        result.text = 'Не удалось расшифровать вложение';
        result.decryptError = true;
    } else if (!encrypted) {
        if (voiceKey) {
            result.voice = {
                key: voiceKey,
                durationSec: wire.voiceDurationSec ?? wire.voice_duration_sec ?? 0,
            };
        }
        if (attachmentKey) {
            result.attachment = {
                key: attachmentKey,
                mime: wire.attachmentMime ?? wire.attachment_mime ?? 'application/octet-stream',
                filename: wire.attachmentFilename ?? wire.attachment_filename ?? 'Файл',
                sizeBytes: wire.attachmentSize ?? wire.attachment_size ?? 0,
            };
        }
    }
    return result;
}

export function mergeMessages(current: Message[], incoming: Message[]): Message[] {
    const merged = new Map(current.map((message) => [message.id, message]));
    for (const message of incoming) {
        merged.set(message.id, message);
    }
    return [...merged.values()].sort((a, b) => a.data - b.data || a.id - b.id);
}

export function messageMatches(
    wire: Pick<
        WireMessage,
        'roomId' | 'sender_username' | 'receiver_username' | 'from' | 'sender_id' | 'receiver_id'
    >,
    chat: ChatRef,
    username: string,
): boolean {
    if (chat.isRoom) {
        return wire.roomId === chat.id;
    }
    if (wire.roomId != null) {
        return false;
    }
    if (wire.sender_id !== undefined || wire.receiver_id !== undefined) {
        return wire.sender_id === chat.id || wire.receiver_id === chat.id;
    }
    return (
        !chat.archived &&
        ((wire.sender_username === chat.name && wire.receiver_username === username) ||
            (wire.sender_username === username && wire.receiver_username === chat.name))
    );
}
