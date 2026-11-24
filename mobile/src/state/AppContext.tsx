import { createContext, useContext } from 'react';
import type { PlayTimeClient } from '../services/client';
import type { CallController } from '../services/calls';
import type { ChatRef, ClientSnapshot } from '../types';

export type Route =
    | {
          name:
              | 'home'
              | 'chat'
              | 'createRoom'
              | 'room'
              | 'profileEdit'
              | 'account'
              | 'sessions'
              | 'password'
              | 'backup'
              | 'restore'
              | 'transfer'
              | 'deleteAccount'
              | 'settings'
              | 'wallpaper'
              | 'plan'
              | 'blocked';
      }
    | { name: 'peer'; username: string; peerUserId?: number };
export type Tab = 'chats' | 'friends' | 'rooms' | 'profile';
export type AppContextValue = {
    client: PlayTimeClient;
    state: ClientSnapshot;
    calls: CallController | null;
    tab: Tab;
    setTab: (tab: Tab) => void;
    navigate: (route: Route) => void;
    back: () => void;
    openChat: (chat: ChatRef) => void;
    showCall: () => void;
};
export const AppContext = createContext<AppContextValue | null>(null);
export function useApp() {
    const value = useContext(AppContext);
    if (!value) {
        throw new Error('AppContext is missing');
    }
    return value;
}
