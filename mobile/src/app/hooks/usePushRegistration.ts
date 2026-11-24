import { useEffect, useRef } from 'react';
import { AppState, NativeEventEmitter } from 'react-native';
import type { PlayTimeClient } from '../../services/client';
import type { ClientSnapshot } from '../../types';
import { PushRegistration, type PushContext } from '../../services/pushRegistration';
import { chatKey } from '../../services/chatIdentity';
import { native } from '../../platform/NativePlayTime';
import {
    mutedNotificationChats,
    notificationsEnabled,
    subscribeNotificationPreferences,
} from '../../platform/notificationPreferences';
import { publishPushStatus, usePushStatus } from '../../platform/pushStatus';

type Options = { client: PlayTimeClient; state: ClientSnapshot; chatVisible: boolean };
type Preferences = { userId: number; enabled: boolean; mutedChats: string[] };

export function usePushRegistration({ client, state, chatVisible }: Options) {
    const visible = useRef(chatVisible);
    visible.current = chatVisible;
    const update = useRef<() => void>(() => undefined);

    useEffect(() => {
        let active = true;
        let readVersion = 0;
        let preferences: Preferences | null = null;
        let sessionInitialized = false;
        let bootstrapping = true;
        let sessionKey: string | undefined;
        let connection: string | undefined;
        const service = new PushRegistration({
            getToken: () => native.getPushToken(),
            reconcileAccount: (userId) => native.reconcilePushAccount(userId),
            setContext: (context) =>
                native.setPushContext(
                    context.userId,
                    context.enabled,
                    context.mutedChats,
                    context.activeChatKey,
                ),
            register: (userId, body) =>
                client.request('/push/device', {
                    method: 'PUT',
                    expectedUserId: userId,
                    body,
                }),
            unregister: (userId) =>
                client.request('/push/device', { method: 'DELETE', expectedUserId: userId }),
        });
        const synchronize = () => {
            const snapshot = client.snapshot;
            if (snapshot.bootstrapping) {
                return;
            }
            const userId = snapshot.session?.user.id ?? null;
            service.restoreAccount(userId, snapshot.session?.token ?? null);
            if (!userId || preferences?.userId !== userId) {
                return;
            }
            const context: PushContext = {
                userId,
                sessionKey: snapshot.session?.token ?? null,
                enabled: preferences.enabled,
                mutedChats: preferences.mutedChats,
                activeChatKey:
                    AppState.currentState === 'active' && visible.current && snapshot.currentChat
                        ? chatKey(snapshot.currentChat)
                        : null,
            };
            service.update(context);
        };
        update.current = synchronize;
        const readPreferences = async () => {
            const version = ++readVersion;
            const snapshot = client.snapshot;
            const session = snapshot.session;
            if (snapshot.bootstrapping || !session) {
                synchronize();
                return;
            }
            const userId = session.user.id;
            try {
                const [enabled, mutedChats] = await Promise.all([
                    notificationsEnabled(userId),
                    mutedNotificationChats(userId),
                ]);
                if (
                    !active ||
                    version !== readVersion ||
                    client.snapshot.bootstrapping ||
                    client.snapshot.session?.token !== session.token ||
                    client.snapshot.session?.user.id !== userId
                ) {
                    return;
                }
                preferences = { userId, enabled, mutedChats };
                synchronize();
                await service.refresh();
            } catch {}
        };
        const sessionChanged = () => {
            const snapshot = client.snapshot;
            const wasBootstrapping = bootstrapping;
            bootstrapping = snapshot.bootstrapping;
            if (bootstrapping) {
                readVersion++;
                return;
            }
            const nextKey = snapshot.session?.token;
            const nextConnection = snapshot.connection;
            if (!sessionInitialized || wasBootstrapping || sessionKey !== nextKey) {
                sessionInitialized = true;
                sessionKey = nextKey;
                readVersion++;
                if (preferences?.userId !== snapshot.session?.user.id) {
                    preferences = null;
                }
                synchronize();
                void readPreferences();
            } else if (connection !== nextConnection && nextConnection === 'online') {
                void readPreferences();
            }
            connection = nextConnection;
        };
        const unsubscribeStatus = service.subscribe(() => publishPushStatus(service.status));
        const unsubscribeClient = client.subscribe(sessionChanged);
        const unsubscribePreferences = subscribeNotificationPreferences((change) => {
            if (change.userId !== client.snapshot.session?.user.id) {
                return;
            }
            if (change.enabled === false) {
                readVersion++;
                preferences = {
                    userId: change.userId,
                    enabled: false,
                    mutedChats: preferences?.mutedChats ?? [],
                };
                synchronize();
            } else {
                void readPreferences();
            }
        });
        const tokenListener = new NativeEventEmitter(native).addListener(
            'PlayTimePushTokenChanged',
            () => void service.refresh(),
        );
        const foreground = AppState.addEventListener('change', (next) => {
            synchronize();
            if (next === 'active') {
                void readPreferences();
            }
        });
        sessionChanged();
        synchronize();
        return () => {
            active = false;
            readVersion++;
            unsubscribeStatus();
            unsubscribeClient();
            unsubscribePreferences();
            tokenListener.remove();
            foreground.remove();
            service.dispose();
            update.current = () => undefined;
            publishPushStatus('disabled');
        };
    }, [client]);

    useEffect(() => {
        update.current();
    }, [state.currentChat, chatVisible]);

    return usePushStatus();
}
