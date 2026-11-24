import { roomEpoch, roomKeyName, DM_PREFIX, ROOM_PREFIX, randomId, type RoomKey } from './crypto';
import { HomeService } from './home';
import { RealtimeEvents, type RealtimeHost } from './realtime';
import { SessionService, type SessionHost } from './session';
import { initialSnapshot } from './snapshot';
import { AccountService } from './account';
import { FriendService } from './friends';
import { RoomService } from './rooms';
import { PeerIdentity } from './peerIdentity';
import { RoomKeys } from './roomKeys';
import { EncryptionService } from './encryption';
import { ChatService } from './chat';
import { AuthFlowStore } from './authFlow';
import { io, type Socket } from 'socket.io-client';
import type {
    ChatRef,
    ClientSnapshot,
    DeviceSession,
    FriendAction,
    LocalMedia,
    MediaDescriptor,
    Message,
    Profile,
    ProfilePatch,
    RevocationChallenge,
    RoomDetail,
    SendMessageOptions,
    Session,
    Wallpaper,
} from '../types';
import { deviceStorage, KeyVault, type SecureStorage } from './storage';
import { messageFromWire, type WireMessage } from './messages';
import type { RequestOptions } from './http';
import { uploadEncryptedMedia, downloadEncryptedMedia, type MediaContext } from './media';
export { ApiError } from './http';
export type { RequestOptions } from './http';

const errorText = (error: unknown) =>
    error instanceof Error ? error.message : 'Не удалось выполнить действие';

export type ClientOptions = {
    baseUrl?: string;
    socketUrl?: string;
    storage?: SecureStorage;
    socketFactory?: typeof io;
    fetch?: typeof fetch;
    timeoutMs?: number;
};
export class PlayTimeClient {
    snapshot: ClientSnapshot = initialSnapshot();
    readonly authFlow: AuthFlowStore;
    readonly callEndpointId = randomId();
    private listeners = new Set<(state: ClientSnapshot) => void>();
    private transport: Socket | null = null;
    private storage: SecureStorage;
    private vault: KeyVault;

    private pendingWaits = new Set<(error: Error) => void>();

    private foreground = true;
    private chatVisible = false;
    private session: SessionService;
    private get generation() {
        return this.session.generation;
    }
    private get baseUrl() {
        return this.session.baseUrl;
    }
    private get socketUrl() {
        return this.session.socketUrl;
    }
    private events: RealtimeEvents;
    private home: HomeService;
    private account: AccountService;
    private friendships: FriendService;
    private rooms: RoomService;
    private encryption: EncryptionService;
    private peers: PeerIdentity;
    private roomKeys: RoomKeys;
    private chat: ChatService;
    constructor(private options: ClientOptions = {}) {
        this.storage = options.storage ?? deviceStorage;
        this.authFlow = new AuthFlowStore(this.storage);
        this.vault = new KeyVault(this.storage);
        const readSnapshot = () => this.snapshot;
        const readGeneration = () => this.generation;
        const readSocket = () => this.transport;
        const isForeground = () => this.foreground;
        const isChatVisible = () => this.chatVisible;
        const host: SessionHost & RealtimeHost = {
            pendingWaits: this.pendingWaits,
            prepareEncryption: () => this.prepareEncryption(),
            refreshAccess: () => this.refreshAccess(),
            loadPreviews: () => this.loadPreviews(),
            wrapForNewMember: (roomId, userId) => this.wrapForNewMember(roomId, userId),
            markRead: () => this.markRead(),
            connect: () => this.connect(),
            disconnect: () => this.disconnect(),
            clearError: () => this.clearError(),
            resetChat: () => this.chat.reset(),
            clearHomeRequest: () => {
                this.home.reset();
            },
            replaceSnapshot: (snapshot) => {
                this.snapshot = snapshot;
            },
            get snapshot() {
                return readSnapshot();
            },
            get generation() {
                return readGeneration();
            },
            get socket() {
                return readSocket();
            },
            get foreground() {
                return isForeground();
            },
            get chatVisible() {
                return isChatVisible();
            },
            storage: this.storage,
            vault: this.vault,
            ack: <T>(event: string, payload?: unknown) => this.ack<T>(event, payload),
            request: <T>(path: string, requestOptions?: RequestOptions) =>
                this.request<T>(path, requestOptions),
            emit: (event, payload) => this.emit(event, payload),
            waitEvent: <T>(
                event: string,
                predicate: (payload: T) => boolean,
                fire: () => void,
                errorEvent?: string,
            ) => this.waitEvent(event, predicate, fire, errorEvent),
            update: (patch) => this.update(patch),
            report: (error) => this.report(error),
            assertSession: () => this.assertSession(),
            assertConnected: () => this.assertConnected(),
            clearSession: () => this.clearSession(),
            clearAuthFlow: () => this.authFlow.clear(),
            closeChat: () => this.closeChat(),
            refreshHome: () => this.refreshHome(),
            reloadHistory: (beforeId) => this.reloadHistory(beforeId),
            getProfile: (username, peerUserId) => this.getProfile(username, peerUserId),
            safety: (username, action, reason, peerUserId) =>
                this.safety(username, action, reason, peerUserId),
            assertEncryption: () => this.assertEncryption(),
            ensureRoomKey: (roomId) => this.ensureRoomKey(roomId),
            peerKey: (username, peerUserId) => this.peerKey(username, peerUserId),
            decode: (data, chat, purpose, historical) =>
                this.decode(data, chat, purpose, historical),
        };
        this.session = new SessionService(host, options);
        this.events = new RealtimeEvents(host);
        this.home = new HomeService(host);
        this.account = new AccountService(host);
        this.friendships = new FriendService(host);
        this.rooms = new RoomService(host);
        this.encryption = new EncryptionService(host);
        this.peers = new PeerIdentity(host);
        this.roomKeys = new RoomKeys(host, this.peers);
        this.chat = new ChatService(host);
    }
    get socket(): Socket | null {
        return this.transport;
    }
    subscribe(listener: (state: ClientSnapshot) => void): () => void {
        this.listeners.add(listener);
        listener(this.snapshot);
        return () => {
            this.listeners.delete(listener);
        };
    }
    private update(patch: Partial<ClientSnapshot>): void {
        this.snapshot = { ...this.snapshot, ...patch };
        for (const listener of this.listeners) {
            listener(this.snapshot);
        }
    }
    clearError(): void {
        this.update({ error: null });
    }
    private report(error: unknown): void {
        this.update({ error: errorText(error) });
    }
    private configure(): Promise<void> {
        return this.session.configure();
    }
    private persistSession(session: Session | null): Promise<void> {
        return this.session.persistSession(session);
    }
    request<T = Record<string, unknown>>(path: string, options: RequestOptions = {}): Promise<T> {
        return this.session.request<T>(path, options);
    }
    private assertSession(): Session {
        return this.session.assertSession();
    }
    private assertConnected(): Socket {
        const socket = this.transport;
        if (!socket?.connected) {
            throw new Error('Нет соединения. Проверьте интернет и повторите.');
        }
        return socket;
    }
    async ack<T = Record<string, unknown>>(event: string, payload: unknown = null): Promise<T> {
        const socket = this.assertConnected();
        const generation = this.generation;
        const noPayload = [
            'get:username',
            'presence:list',
            'presence:listByUserId',
            'message:lastPreviews',
        ].includes(event);
        let result: T & { err?: string; success?: boolean };
        try {
            result = await (noPayload
                ? socket.timeout(this.options.timeoutMs ?? 12000).emitWithAck(event)
                : socket.timeout(this.options.timeoutMs ?? 12000).emitWithAck(event, payload));
        } catch {
            throw new Error('Сервер не подтвердил действие. Проверьте подключение и повторите.');
        }
        if (generation !== this.generation || socket !== this.transport) {
            throw new Error('Сеанс изменился. Повторите действие.');
        }
        if (result && typeof result === 'object' && (result.err || result.success === false)) {
            throw new Error(result.err || 'Не удалось выполнить действие');
        }
        return result;
    }
    emit(event: string, payload?: unknown): void {
        this.assertConnected().emit(event, payload);
    }
    private waitEvent<T>(
        event: string,
        predicate: (payload: T) => boolean,
        fire: () => void,
        errorEvent?: string,
    ): Promise<T> {
        const socket = this.assertConnected();
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timer);
                socket.off(event, success);
                if (errorEvent) {
                    socket.off(errorEvent, failure);
                }
                this.pendingWaits.delete(cancel);
            };
            const success = (payload: T) => {
                if (!predicate(payload)) {
                    return;
                }
                cleanup();
                resolve(payload);
            };
            const failure = (payload: { err?: string; requestId?: string }) => {
                if (event === 'message:getMessages:success' && !predicate(payload as T)) {
                    return;
                }
                cleanup();
                reject(new Error(payload?.err || 'Не удалось выполнить действие'));
            };
            const cancel = (error: Error) => {
                cleanup();
                reject(error);
            };
            const timer = setTimeout(
                () => cancel(new Error('Сервер не подтвердил действие. Повторите попытку.')),
                this.options.timeoutMs ?? 12000,
            );
            socket.on(event, success);
            if (errorEvent) {
                socket.on(errorEvent, failure);
            }
            this.pendingWaits.add(cancel);
            try {
                fire();
            } catch (error) {
                cancel(error instanceof Error ? error : new Error('Не удалось отправить запрос'));
            }
        });
    }
    bootstrap(): Promise<void> {
        return this.session.bootstrap();
    }
    login(email: string, password: string): Promise<void> {
        return this.session.login(email, password);
    }
    register(
        username: string,
        email: string,
        password: string,
    ): Promise<{ verificationRequired: boolean }> {
        return this.session.register(username, email, password);
    }
    verifyEmail(email: string, code: string): Promise<void> {
        return this.session.verifyEmail(email, code);
    }
    resendVerification(email: string): Promise<void> {
        return this.session.resendVerification(email);
    }
    requestPasswordRecovery(email: string): Promise<void> {
        return this.session.requestPasswordRecovery(email);
    }
    resetPassword(email: string, code: string, password: string): Promise<void> {
        return this.session.resetPassword(email, code, password);
    }
    private revokeCredentials(session: Session): Promise<void> {
        return this.session.revokeCredentials(session);
    }
    private clearSession(): Promise<void> {
        return this.session.clearSession();
    }
    logout(): Promise<void> {
        return this.session.logout();
    }
    private scheduleRefresh(): void {
        return this.session.scheduleRefresh();
    }
    private refreshAccess(): Promise<boolean> {
        return this.session.refreshAccess();
    }
    reconnect(): Promise<void> {
        return this.session.reconnect();
    }
    setChatVisible(visible: boolean): void {
        const changed = visible !== this.chatVisible;
        this.chatVisible = visible;
        if (visible) {
            this.markRead();
            if (changed && this.snapshot.currentChat && this.transport?.connected) {
                void this.reloadHistory().catch((error) => this.report(error));
            }
        } else {
            this.typing(false);
        }
    }
    setForeground(active: boolean): void {
        this.foreground = active;
        if (active) {
            if (this.snapshot.session) {
                void this.reconnect().catch((error) => this.report(error));
            }
            this.markRead();
        } else {
            this.typing(false);
        }
    }
    private disconnect(): void {
        this.session.clearRefreshTimer();
        this.chat.clearTypingTimer();
        this.events.clearTimers();
        for (const cancel of [...this.pendingWaits]) {
            cancel(new Error('Соединение закрыто'));
        }
        this.transport?.removeAllListeners();
        this.transport?.disconnect();
        this.transport = null;
    }
    dispose(): void {
        this.disconnect();
        this.listeners.clear();
    }
    private connect(): void {
        if (!this.snapshot.session) {
            return;
        }
        if (this.transport) {
            this.transport.connect();
            return;
        }
        const socket = (this.options.socketFactory ?? io)(this.socketUrl, {
            path: '/playtime/socket.io',
            autoConnect: false,
            transports: ['websocket'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 15000,
            auth: (callback) =>
                callback({
                    token: this.snapshot.session?.token ?? '',
                    callProtocol: 3,
                    callEndpointId: this.callEndpointId,
                    peerIdentityProtocol: 1,
                }),
        });
        this.transport = socket;
        this.update({ connection: 'connecting' });
        this.events.attach(socket);
        socket.connect();
    }
    private async decode(
        data: WireMessage,
        chat: ChatRef,
        purpose: 'message' | 'preview' = 'message',
        historical = false,
    ): Promise<Message> {
        const generation = this.generation;
        const owner = this.snapshot.session?.user;
        const me =
            data.sender_id !== undefined
                ? data.sender_id === owner?.id
                : data.me ?? (data.sender_username ?? data.from) === owner?.username;
        const wire = { ...data, me };
        let room: string | undefined;
        if (chat.isRoom && data.content.startsWith(ROOM_PREFIX)) {
            const epoch = roomEpoch(data.content);
            room = this.vault.read(roomKeyName(chat.id, epoch));
            if (!room && purpose === 'message') {
                room = await this.roomKeys
                    .ensureRoomKey(chat.id, epoch)
                    .then((result) => result.key)
                    .catch(() => undefined);
            }
        }
        const decode = (dm?: string) =>
            messageFromWire(wire, chat, owner?.username ?? '', dm, room, purpose);
        const message = decode(this.vault.read('dm'));
        if (!chat.isRoom && !me && !message.decryptError && data.content.startsWith(DM_PREFIX)) {
            const key = data.senderDmPublicKey ?? data.sender_dm_public_key;
            try {
                if (!key || generation !== this.generation) {
                    return decode();
                }
                await this.peers.checkPeerIdentity(chat.name, chat.id, key, historical);
            } catch {
                return decode();
            }
        }
        return message;
    }

    refreshHome(): Promise<void> {
        return this.home.refreshHome();
    }
    private loadPreviews(): Promise<void> {
        return this.home.loadPreviews();
    }
    private prepareEncryption(): Promise<void> {
        return this.encryption.prepareEncryption();
    }
    private assertEncryption(): string {
        return this.encryption.assertEncryption();
    }
    private peerKey(username: string, peerUserId?: number): Promise<string> {
        return this.peers.peerKey(username, peerUserId);
    }
    trustChangedPeer(expectedKey?: string, expectedPeerId?: number): Promise<void> {
        return this.peers.trustChangedPeer(expectedKey, expectedPeerId);
    }
    private ensureRoomKey(roomId: number): Promise<RoomKey> {
        return this.roomKeys.ensureRoomKey(roomId);
    }
    private wrapForNewMember(roomId: number, userId: number): Promise<void> {
        return this.roomKeys.wrapForNewMember(roomId, userId);
    }
    openChat(chat: ChatRef): Promise<void> {
        this.chatVisible = true;
        return this.chat.openChat(chat);
    }
    closeChat(): void {
        this.chatVisible = false;
        return this.chat.closeChat();
    }
    private reloadHistory(beforeId?: number): Promise<void> {
        return this.chat.reloadHistory(beforeId);
    }
    loadOlder(): Promise<void> {
        return this.chat.loadOlder();
    }
    markRead(): void {
        return this.chat.markRead();
    }
    typing(active: boolean): void {
        return this.chat.typing(active);
    }
    private currentChat(): ChatRef {
        return this.chat.currentChat();
    }
    private encryptedText(chat: ChatRef, content: string): Promise<string> {
        return this.chat.encryptedText(chat, content);
    }
    sendMessage(raw: string, options: SendMessageOptions = {}): Promise<void> {
        return this.chat.sendMessage(raw, options);
    }
    editMessage(id: number, raw: string): Promise<void> {
        return this.chat.editMessage(id, raw);
    }
    deleteMessage(id: number): Promise<void> {
        return this.chat.deleteMessage(id);
    }
    react(id: number, emoji: string): Promise<void> {
        return this.chat.react(id, emoji);
    }
    pin(id: number | null): Promise<void> {
        return this.chat.pin(id);
    }
    readers(messageId: number): Promise<string[]> {
        return this.chat.readers(messageId);
    }
    search(query: string): Message[] {
        return this.chat.search(query);
    }
    setWallpaper(state: Wallpaper): Promise<void> {
        return this.chat.setWallpaper(state);
    }
    friendAction(action: FriendAction, username: string, peerUserId?: number): Promise<void> {
        return this.friendships.friendAction(action, username, peerUserId);
    }
    createRoom(name: string): Promise<ChatRef> {
        return this.rooms.createRoom(name);
    }
    updateRoom(roomId: number, patch: { name: string }): Promise<void> {
        return this.rooms.updateRoom(roomId, patch);
    }
    roomMembers(roomId: number): Promise<RoomDetail> {
        return this.rooms.roomMembers(roomId);
    }
    addRoomMembers(roomId: number, usernames: string[]): Promise<void> {
        return this.rooms.addRoomMembers(roomId, usernames);
    }
    removeRoomMember(roomId: number, userId: number): Promise<void> {
        return this.rooms.removeRoomMember(roomId, userId);
    }
    setRoomRole(roomId: number, userId: number, role: 'member' | 'moderator'): Promise<void> {
        return this.rooms.setRoomRole(roomId, userId, role);
    }
    transferRoomOwnership(roomId: number, userId: number): Promise<void> {
        return this.rooms.transferRoomOwnership(roomId, userId);
    }
    leaveRoom(roomId: number): Promise<void> {
        return this.rooms.leaveRoom(roomId);
    }
    deleteRoom(roomId: number): Promise<void> {
        return this.rooms.deleteRoom(roomId);
    }
    getProfile(username?: string, peerUserId?: number): Promise<Profile> {
        return this.account.getProfile(username, peerUserId);
    }
    updateProfile(patch: ProfilePatch): Promise<void> {
        return this.account.updateProfile(patch);
    }
    sessions(): Promise<DeviceSession[]> {
        return this.account.sessions();
    }
    requestSessionRevocation(sessionId: string | null): Promise<RevocationChallenge> {
        return this.account.requestSessionRevocation(sessionId);
    }
    revokeSession(sessionId: string | null, challengeId: string, code: string): Promise<void> {
        return this.account.revokeSession(sessionId, challengeId, code);
    }
    changePassword(currentPassword: string, newPassword: string): Promise<void> {
        return this.account.changePassword(currentPassword, newPassword);
    }
    deleteAccount(password: string): Promise<void> {
        return this.account.deleteAccount(password);
    }
    blockedUsers(): Promise<string[]> {
        return this.account.blockedUsers();
    }
    safety(
        username: string,
        action: 'block' | 'unblock' | 'report',
        reason?: string,
        peerUserId?: number,
    ): Promise<void> {
        return this.account.safety(username, action, reason, peerUserId);
    }
    exportKeys(password: string): Promise<string> {
        return this.encryption.exportKeys(password);
    }
    encryptionFingerprint(): Promise<string | null> {
        return this.encryption.encryptionFingerprint();
    }
    private replaceKeys(keys: Record<string, string>): Promise<void> {
        return this.encryption.replaceKeys(keys);
    }
    importKeys(source: string, password: string): Promise<void> {
        return this.encryption.importKeys(source, password);
    }
    continueWithNewEncryptionKey(): Promise<void> {
        return this.encryption.continueWithNewEncryptionKey();
    }
    resetEncryptionKeys(): Promise<void> {
        return this.encryption.resetEncryptionKeys();
    }
    createKeyTransfer(): Promise<{ code: string; expiresAt: number }> {
        return this.encryption.createKeyTransfer();
    }
    consumeKeyTransfer(code: string): Promise<void> {
        return this.encryption.consumeKeyTransfer(code);
    }
    private mediaContext(): MediaContext {
        const session = this.assertSession();
        const generation = this.generation;
        return {
            apiBase: this.baseUrl,
            token: session.token,
            fetcher: this.options.fetch ?? fetch,
            maxAttachmentBytes:
                this.snapshot.subscription?.limits.maxAttachmentBytes ?? 3 * 1024 * 1024,
            maxVoiceMessageSec: this.snapshot.subscription?.limits.maxVoiceMessageSec ?? 60,
            isCurrent: () => generation === this.generation,
        };
    }
    async uploadMedia(file: LocalMedia, kind: 'voice' | 'attachment'): Promise<MediaDescriptor> {
        this.assertEncryption();
        return uploadEncryptedMedia(file, kind, this.mediaContext());
    }
    async downloadMedia(descriptor: MediaDescriptor): Promise<string> {
        return downloadEncryptedMedia(descriptor, this.mediaContext());
    }
}
