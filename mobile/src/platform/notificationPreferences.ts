import { preferencesStorage } from './preferencesStorage';
import type { ChatRef } from '../types';
import { chatKey } from '../services/chatIdentity';

type PreferenceChange = { userId: number; enabled?: boolean };
const listeners = new Set<(change: PreferenceChange) => void>();
type NotificationIntent = { enabled: boolean };
const notificationIntents = new Map<number, NotificationIntent>();
const notificationWrites = new Map<number, Promise<void>>();

export function subscribeNotificationPreferences(
    listener: (change: PreferenceChange) => void,
): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function publish(change: PreferenceChange): void {
    listeners.forEach((listener) => listener(change));
}

function muteKey(userId: number, chat: ChatRef): string {
    return `notification-muted:${userId}:${chatKey(chat)}`;
}

export async function notificationsEnabled(userId: number): Promise<boolean> {
    const pending = notificationIntents.get(userId);
    if (pending) {
        return pending.enabled;
    }
    const stored = await preferencesStorage.getItem(`notifications:${userId}`);
    return notificationIntents.get(userId)?.enabled ?? stored === 'true';
}

export async function setNotificationsEnabled(userId: number, enabled: boolean): Promise<void> {
    const intent = {
        enabled: enabled ? notificationIntents.get(userId)?.enabled ?? false : false,
    };
    notificationIntents.set(userId, intent);
    if (!enabled) {
        publish({ userId, enabled: false });
    }
    const work = (notificationWrites.get(userId) ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => preferencesStorage.setItem(`notifications:${userId}`, String(enabled)));
    notificationWrites.set(userId, work);
    try {
        await work;
        if (notificationIntents.get(userId) === intent) {
            intent.enabled = enabled;
            publish({ userId, enabled });
        }
    } finally {
        if (notificationWrites.get(userId) === work) {
            notificationWrites.delete(userId);
        }
    }
}

export async function chatNotificationsMuted(userId: number, chat: ChatRef): Promise<boolean> {
    return (await preferencesStorage.getItem(muteKey(userId, chat))) === 'true';
}

export async function mutedNotificationChats(userId: number): Promise<string[]> {
    const prefix = `notification-muted:${userId}:`;
    const keys = (await preferencesStorage.keys()).filter((key) => key.startsWith(prefix));
    const values = await Promise.all(
        keys.map(async (key) => ({ key, value: await preferencesStorage.getItem(key) })),
    );
    return values
        .filter(({ value }) => value === 'true')
        .map(({ key }) => key.slice(prefix.length));
}

export async function setChatNotificationsMuted(
    userId: number,
    chat: ChatRef,
    muted: boolean,
): Promise<void> {
    await preferencesStorage.setItem(muteKey(userId, chat), String(muted));
    publish({ userId });
}
