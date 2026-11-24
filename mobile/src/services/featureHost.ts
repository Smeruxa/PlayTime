import type { RoomKey } from './crypto';
import type { Socket } from 'socket.io-client';
import type { ChatRef, ClientSnapshot, Message, Profile, Session } from '../types';
import type { RequestOptions } from './http';
import type { WireMessage } from './messages';
import type { KeyVault, SecureStorage } from './storage';

export interface FeatureHost {
    readonly snapshot: ClientSnapshot;
    readonly generation: number;
    readonly socket: Socket | null;
    readonly foreground: boolean;
    readonly chatVisible: boolean;
    readonly storage: SecureStorage;
    readonly vault: KeyVault;
    ack<T = Record<string, unknown>>(event: string, payload?: unknown): Promise<T>;
    request<T = Record<string, unknown>>(path: string, options?: RequestOptions): Promise<T>;
    emit(event: string, payload?: unknown): void;
    waitEvent<T>(
        event: string,
        predicate: (payload: T) => boolean,
        fire: () => void,
        errorEvent?: string,
    ): Promise<T>;
    update(patch: Partial<ClientSnapshot>): void;
    report(error: unknown): void;
    assertSession(): Session;
    assertConnected(): Socket;
    clearSession(): Promise<void>;
    closeChat(): void;
    refreshHome(): Promise<void>;
    reloadHistory(beforeId?: number): Promise<void>;
    getProfile(username?: string, peerUserId?: number): Promise<Profile>;
    safety(
        username: string,
        action: 'block' | 'unblock' | 'report',
        reason?: string,
        peerUserId?: number,
    ): Promise<void>;
    assertEncryption(): string;
    ensureRoomKey(roomId: number): Promise<RoomKey>;
    peerKey(username: string, peerUserId?: number): Promise<string>;
    decode(
        data: WireMessage,
        chat: ChatRef,
        purpose?: 'message' | 'preview',
        historical?: boolean,
    ): Promise<Message>;
}
