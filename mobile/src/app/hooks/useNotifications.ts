import { useEffect, useRef, useState } from 'react';
import { AppState, NativeEventEmitter } from 'react-native';
import type { PlayTimeClient } from '../../services/client';
import type { WireMessage } from '../../services/messages';
import type { ChatRef, ClientSnapshot } from '../../types';
import { native } from '../../platform/NativePlayTime';
import {
    chatNotificationsMuted,
    notificationsEnabled,
} from '../../platform/notificationPreferences';
import {
    parseNotificationTarget,
    resolveMessageChat,
    resolveNotificationChat,
    type NotificationTarget,
} from '../../platform/notificationTarget';

type Options = {
    client: PlayTimeClient;
    state: ClientSnapshot;
    chatVisible: boolean;
    openChat: (chat: ChatRef) => void;
    showCall: () => void;
};

export function useNotifications({ client, state, chatVisible, openChat, showCall }: Options) {
    const [pendingCall, setPendingCall] = useState(false);
    const [pending, setPending] = useState<NotificationTarget | null>(null);
    const visible = useRef(chatVisible);
    visible.current = chatVisible;
    const socket = client.socket;
    const userId = state.session?.user.id;

    useEffect(() => {
        let active = true;
        const receive = (event: unknown) => {
            if (
                active &&
                event &&
                typeof event === 'object' &&
                'chat' in event &&
                typeof event.chat === 'string'
            ) {
                if (event.chat === 'active-call') {
                    setPendingCall(true);
                } else {
                    setPending(parseNotificationTarget(event.chat));
                }
            }
        };
        const consumePending = () => {
            void native
                .getInitialNotification()
                .then(receive)
                .catch(() => undefined);
        };
        const listener = new NativeEventEmitter(native).addListener(
            'PlayTimeNotificationOpen',
            consumePending,
        );
        const foreground = AppState.addEventListener('change', (next) => {
            if (next === 'active') {
                consumePending();
            }
        });
        consumePending();
        return () => {
            active = false;
            listener.remove();
            foreground.remove();
        };
    }, []);

    useEffect(() => {
        if (pendingCall && userId && !state.bootstrapping) {
            setPendingCall(false);
            showCall();
        }
    }, [pendingCall, userId, state.bootstrapping, showCall]);

    useEffect(() => {
        if (!pending || !userId || state.bootstrapping) {
            return;
        }
        if (pending.userId !== userId) {
            setPending(null);
            return;
        }
        if (pending.kind === 'call') {
            setPending(null);
            showCall();
            return;
        }
        const chat = resolveNotificationChat(pending, state);
        if (chat) {
            setPending(null);
            openChat(chat);
        }
    }, [pending, state, userId, openChat, showCall]);

    useEffect(() => {
        if (!socket || !userId) {
            return;
        }
        let active = true;
        const notified = new Set<number>();
        const message = async (wire: WireMessage) => {
            if (notified.has(wire.id)) {
                return;
            }
            const chat = resolveMessageChat(wire, client.snapshot);
            if (!chat) {
                return;
            }
            const selected = client.snapshot.currentChat;
            if (
                AppState.currentState === 'active' &&
                visible.current &&
                selected?.isRoom === chat.isRoom &&
                selected.id === chat.id
            ) {
                return;
            }
            if (
                !(await notificationsEnabled(userId)) ||
                (await chatNotificationsMuted(userId, chat))
            ) {
                return;
            }
            if (!active || client.snapshot.session?.user.id !== userId) {
                return;
            }
            notified.add(wire.id);
            if (notified.size > 300) {
                notified.delete(notified.values().next().value!);
            }
            const target: NotificationTarget = { version: 1, userId, kind: 'chat', ...chat };
            await native.showNotification(
                chat.name,
                'Новое сообщение',
                JSON.stringify({ ...target, eventId: `m:${wire.id}` }),
            );
        };
        type IncomingCall = {
            from?: string;
            caller?: string;
            username?: string;
            roomId?: string;
            expiresAt?: number;
        };
        const incoming = async (payload: IncomingCall) => {
            if (AppState.currentState === 'active' || !(await notificationsEnabled(userId))) {
                return;
            }
            if (!active || client.snapshot.session?.user.id !== userId) {
                return;
            }
            const target: NotificationTarget = { version: 1, userId, kind: 'call' };
            await native.showNotification(
                payload.from || payload.caller || payload.username || 'PlayTime',
                'Входящий звонок',
                JSON.stringify({
                    ...target,
                    eventId: payload.roomId ? `c:${payload.roomId}` : undefined,
                    expiresAt: payload.expiresAt,
                }),
            );
        };
        const onMessage = (wire: WireMessage) => void message(wire).catch(() => undefined);
        const onCall = (payload: IncomingCall) => void incoming(payload).catch(() => undefined);
        socket.on('message:receive', onMessage);
        socket.on('call:incomingCall', onCall);
        return () => {
            active = false;
            socket.off('message:receive', onMessage);
            socket.off('call:incomingCall', onCall);
        };
    }, [client, socket, userId]);
}
