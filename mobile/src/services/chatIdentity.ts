import type { ChatRef } from '../types';

export type ChatKey = `room:${number}` | `dm:${string}`;

export function chatKey(chat: Pick<ChatRef, 'id' | 'name' | 'isRoom'>): ChatKey {
    return chat.isRoom ? `room:${chat.id}` : `dm:${chat.id}`;
}
