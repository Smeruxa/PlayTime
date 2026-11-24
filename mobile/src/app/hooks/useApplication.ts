import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState, BackHandler, Keyboard } from 'react-native';
import { useNotifications } from './useNotifications';
import { usePushRegistration } from './usePushRegistration';
import { PlayTimeClient } from '../../services/client';
import { CallController } from '../../features/calls/CallController';
import type { ChatRef } from '../../types';
import type { AppContextValue, Route, Tab } from '../../state/AppContext';

export function useApplication() {
    const [client] = useState(() => new PlayTimeClient());
    const subscribe = useCallback((notify: () => void) => client.subscribe(notify), [client]);
    const getSnapshot = useCallback(() => client.snapshot, [client]);
    const state = useSyncExternalStore(subscribe, getSnapshot);
    const [routes, setRoutes] = useState<Route[]>([{ name: 'home' }]);
    const [tab, updateTab] = useState<Tab>('chats');
    const [calls, setCalls] = useState<CallController | null>(null);
    const [callVisible, setCallVisible] = useState(false);
    const [callActive, setCallActive] = useState(false);
    const [keyboardVisible, setKeyboardVisible] = useState(false);
    const route = routes[routes.length - 1];
    const socket = client.socket;
    const userId = state.session?.user.id;
    const username = state.session?.user.username;
    const chatVisible = route.name === 'chat' && !callVisible;

    usePushRegistration({ client, state, chatVisible });

    useEffect(() => {
        void client.bootstrap();
        const appState = AppState.addEventListener('change', (next) =>
            client.setForeground(next === 'active'),
        );
        const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
        const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
        return () => {
            appState.remove();
            show.remove();
            hide.remove();
            client.dispose();
        };
    }, [client]);

    useEffect(() => {
        if (!socket || !userId || !username) {
            setCalls(null);
            setCallActive(false);
            setCallVisible(false);
            return;
        }
        const controller = new CallController({ socket, userId, username });
        setCalls(controller);
        let previousRoom: string | number | undefined;
        const unsubscribe = controller.subscribe((snapshot) => {
            setCallActive(!!snapshot.call);
            if (snapshot.call && snapshot.call.roomId !== previousRoom) {
                Keyboard.dismiss();
                setCallVisible(true);
            }
            if (!snapshot.call) {
                setCallVisible(false);
            }
            previousRoom = snapshot.call?.roomId;
        });
        return () => {
            unsubscribe();
            controller.dispose();
        };
    }, [socket, userId, username]);

    useEffect(() => {
        if (calls) {
            void calls.updateLimits(state.subscription?.limits ?? null);
        }
    }, [calls, state.subscription?.limits]);

    useEffect(() => {
        if (!state.session) {
            setRoutes([{ name: 'home' }]);
            updateTab('chats');
        }
    }, [state.session]);

    useEffect(() => {
        if (route.name === 'chat' && !state.currentChat && !state.historyLoading) {
            setRoutes([{ name: 'home' }]);
        }
    }, [route.name, state.currentChat, state.historyLoading]);

    const back = useCallback(() => {
        Keyboard.dismiss();
        setRoutes((current) => (current.length > 1 ? current.slice(0, -1) : current));
    }, []);

    useEffect(() => {
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            if (callVisible) {
                setCallVisible(false);
                return true;
            }
            if (routes.length > 1) {
                back();
                return true;
            }
            return false;
        });
        return () => subscription.remove();
    }, [back, callVisible, routes.length]);

    useEffect(() => {
        client.setChatVisible(route.name === 'chat' && !callVisible);
    }, [client, route.name, callVisible]);

    const navigate = useCallback((next: Route) => {
        Keyboard.dismiss();
        setRoutes((current) => [...current, next]);
    }, []);
    const setTab = useCallback(
        (next: Tab) => {
            Keyboard.dismiss();
            client.closeChat();
            updateTab(next);
            setRoutes([{ name: 'home' }]);
        },
        [client],
    );
    const openChat = useCallback(
        (chat: ChatRef) => {
            Keyboard.dismiss();
            setRoutes([{ name: 'home' }, { name: 'chat' }]);
            void client.openChat(chat).catch(() => {});
        },
        [client],
    );
    const showCall = useCallback(() => {
        Keyboard.dismiss();
        setCallVisible(true);
    }, []);
    useNotifications({
        client,
        state,
        chatVisible: route.name === 'chat' && !callVisible,
        openChat,
        showCall,
    });
    const context = useMemo<AppContextValue>(
        () => ({ client, state, calls, tab, setTab, navigate, back, openChat, showCall }),
        [client, state, calls, tab, setTab, navigate, back, openChat, showCall],
    );

    return {
        context,
        route,
        callVisible,
        callActive,
        keyboardVisible,
        minimizeCall: () => setCallVisible(false),
    };
}
