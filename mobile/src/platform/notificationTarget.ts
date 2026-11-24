import type { ChatRef, ClientSnapshot } from '../types';
import type { WireMessage } from '../services/messages';

export type NotificationTarget =
    | { version: 1; userId: number; kind: 'chat'; id: number; isRoom: boolean; name: string }
    | { version: 1; userId: number; kind: 'call' };

export function parseNotificationTarget(source: string): NotificationTarget | null {
    if (source.length > 2048) {
        return null;
    }
    try {
        const value: unknown = JSON.parse(source);
        if (!value || typeof value !== 'object') {
            return null;
        }
        const target = value as Record<string, unknown>;
        if (
            target.version !== 1 ||
            typeof target.userId !== 'number' ||
            !Number.isSafeInteger(target.userId)
        ) {
            return null;
        }
        if (target.kind === 'call') {
            return { version: 1, userId: target.userId, kind: 'call' };
        }
        if (
            target.kind !== 'chat' ||
            typeof target.id !== 'number' ||
            !Number.isSafeInteger(target.id) ||
            typeof target.isRoom !== 'boolean' ||
            typeof target.name !== 'string'
        ) {
            return null;
        }
        return {
            version: 1,
            userId: target.userId,
            kind: 'chat',
            id: target.id,
            isRoom: target.isRoom,
            name: target.name,
        };
    } catch {
        return null;
    }
}

export function resolveMessageChat(message: WireMessage, state: ClientSnapshot): ChatRef | null {
    if (message.sender_username === state.session?.user.username || message.me) {
        return null;
    }
    if (message.roomId != null) {
        const room = state.rooms.find((candidate) => candidate.id === message.roomId);
        return room
            ? { id: room.id, name: room.name, isRoom: true, createdBy: room.created_by }
            : null;
    }
    const friend = state.friends.find((candidate) => candidate.friend_id === message.sender_id);
    return friend
        ? {
              id: friend.friend_id,
              name: friend.friend_username,
              isRoom: false,
              archived: !!friend.friend_archived,
          }
        : null;
}

export function resolveNotificationChat(
    target: NotificationTarget,
    state: ClientSnapshot,
): ChatRef | null {
    if (target.kind !== 'chat' || target.userId !== state.session?.user.id) {
        return null;
    }
    if (target.isRoom) {
        const room = state.rooms.find((candidate) => candidate.id === target.id);
        return room
            ? { id: room.id, name: room.name, isRoom: true, createdBy: room.created_by }
            : null;
    }
    const friend = state.friends.find((candidate) => candidate.friend_id === target.id);
    return friend
        ? {
              id: friend.friend_id,
              name: friend.friend_username,
              isRoom: false,
              archived: !!friend.friend_archived,
          }
        : null;
}
