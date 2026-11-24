import type { FeatureHost } from './featureHost';
import type { ChatRef, Message, SendMessageOptions, Wallpaper } from '../types';
import { randomId, encryptDm, encryptRoom, MEDIA_PREFIX } from './crypto';
import { mergeMessages, type WireMessage } from './messages';
import { chatKey } from './chatIdentity';
const errorText = (error: unknown) =>
    error instanceof Error ? error.message : 'Не удалось выполнить действие';
type History = {
    requestId: string;
    messages: WireMessage[];
    beforeId?: number;
    pinnedMessageId?: number | null;
    roomReadWatermark?: number;
    hasMore?: boolean;
};

export class ChatService {
    constructor(private host: FeatureHost) {}
    private chatGeneration = 0;
    private historyInitialized = false;
    private typingTimer: ReturnType<typeof setTimeout> | null = null;
    private lastTypingAt = 0;
    private pendingSend: {
        fingerprint: string;
        id: string;
    } | null = null;
    private sending = false;
    reset(): void {
        this.chatGeneration++;
        this.historyInitialized = false;
        this.pendingSend = null;
        this.clearTypingTimer();
    }
    clearTypingTimer(): void {
        if (this.typingTimer) {
            clearTimeout(this.typingTimer);
        }
        this.typingTimer = null;
        this.lastTypingAt = 0;
    }
    async openChat(chat: ChatRef): Promise<void> {
        this.typing(false);
        this.chatGeneration++;
        this.historyInitialized = false;
        this.host.update({
            currentChat: chat,
            messages: [],
            historyLoading: true,
            hasMore: false,
            pinnedMessageId: null,
            roomReadWatermark: 0,
            typingUsers: [],
            wallpaper: { kind: 'none' },
            error: null,
        });
        await this.reloadHistory();
    }

    closeChat(): void {
        this.typing(false);
        this.chatGeneration++;
        this.historyInitialized = false;
        this.host.update({
            currentChat: null,
            messages: [],
            historyLoading: false,
            hasMore: false,
            pinnedMessageId: null,
            roomReadWatermark: 0,
            typingUsers: [],
            wallpaper: { kind: 'none' },
        });
    }

    async reloadHistory(beforeId?: number): Promise<void> {
        const chat = this.host.snapshot.currentChat;
        if (!chat || !this.host.chatVisible || !this.host.foreground) {
            return;
        }
        const generation = this.chatGeneration;
        this.host.update({ historyLoading: true });
        try {
            if (chat.isRoom) {
                await this.host.ensureRoomKey(chat.id).catch((error) => {
                    if (generation === this.chatGeneration) {
                        this.host.report(error);
                    }
                });
            }
            if (generation !== this.chatGeneration) {
                return;
            }
            const requestId = randomId();
            const result = await this.host.waitEvent<History>(
                'message:getMessages:success',
                (data) => data?.requestId === requestId,
                () =>
                    this.host.emit('message:getMessages', {
                        username: chat.name,
                        peerUserId: chat.id,
                        ...(chat.isRoom ? { roomId: chat.id } : {}),
                        requestId,
                        ...(beforeId ? { beforeId } : {}),
                    }),
                'message:getMessages:error',
            );
            if (generation !== this.chatGeneration) {
                return;
            }
            const messages: Message[] = [];
            for (const row of result.messages) {
                if (generation !== this.chatGeneration) {
                    return;
                }
                messages.push(await this.host.decode(row, chat, 'message', true));
            }
            if (generation !== this.chatGeneration) {
                return;
            }
            this.host.update({
                messages: mergeMessages(this.host.snapshot.messages, messages),
                hasMore: !!result.hasMore,
                ...(beforeId ? {} : { pinnedMessageId: result.pinnedMessageId ?? null }),
                ...(!this.historyInitialized
                    ? { roomReadWatermark: chat.isRoom ? result.roomReadWatermark ?? 0 : 0 }
                    : {}),
            });
            this.historyInitialized = true;
            this.markRead();
            if (!chat.isRoom && !beforeId) {
                const wallpaper = await this.host.ack<{ state?: Wallpaper }>('dmWallpaper:get', {
                    peerUsername: chat.name,
                    peerUserId: chat.id,
                });
                if (generation === this.chatGeneration) {
                    this.host.update({ wallpaper: wallpaper.state ?? { kind: 'none' } });
                }
            }
        } finally {
            if (generation === this.chatGeneration) {
                this.host.update({ historyLoading: false });
            }
        }
    }

    async loadOlder(): Promise<void> {
        if (
            !this.host.snapshot.currentChat?.isRoom ||
            !this.host.snapshot.hasMore ||
            this.host.snapshot.historyLoading
        ) {
            return;
        }
        const ids = this.host.snapshot.messages.map((message) => message.id).filter((id) => id > 0);
        if (ids.length) {
            await this.reloadHistory(Math.min(...ids));
        }
    }

    markRead(): void {
        const chat = this.host.snapshot.currentChat;
        if (
            !chat ||
            !this.historyInitialized ||
            !this.host.socket?.connected ||
            !this.host.foreground ||
            !this.host.chatVisible
        ) {
            return;
        }
        this.host.socket.emit(
            chat.isRoom ? 'message:markRoomRead' : 'message:markRead',
            chat.isRoom ? { roomId: chat.id } : { username: chat.name, peerUserId: chat.id },
        );
        const key = chatKey(chat);
        const preview = this.host.snapshot.previews[key];
        if (preview?.unread) {
            this.host.update({
                previews: { ...this.host.snapshot.previews, [key]: { ...preview, unread: 0 } },
            });
        }
    }

    typing(active: boolean): void {
        if (this.typingTimer) {
            clearTimeout(this.typingTimer);
        }
        this.typingTimer = null;
        const chat = this.host.snapshot.currentChat;
        if (!chat || chat.archived || !this.host.socket?.connected) {
            return;
        }
        const send = (typing: boolean) => {
            if (this.host.socket?.connected) {
                this.host.socket.emit('chat:typing', {
                    ...(chat.isRoom
                        ? { roomId: chat.id }
                        : { dmUsername: chat.name, peerUserId: chat.id }),
                    typing,
                });
            }
        };
        if (!active) {
            send(false);
            this.lastTypingAt = 0;
            return;
        }
        if (Date.now() - this.lastTypingAt > 2000) {
            send(true);
            this.lastTypingAt = Date.now();
        }
        this.typingTimer = setTimeout(() => {
            send(false);
            this.lastTypingAt = 0;
        }, 2800);
    }

    currentChat(): ChatRef {
        const chat = this.host.snapshot.currentChat;
        if (!chat) {
            throw new Error('Сначала откройте переписку');
        }
        return chat;
    }

    private writableChat(): ChatRef {
        const chat = this.currentChat();
        if (chat.archived && !chat.isRoom) {
            throw new Error('Гость вышел. Переписка доступна только для чтения.');
        }
        return chat;
    }

    async encryptedText(chat: ChatRef, content: string): Promise<string> {
        if (content.length > 2000) {
            throw new Error('Не более 2000 символов в сообщении');
        }
        const secret = this.host.assertEncryption();
        if (chat.isRoom) {
            const roomKey = await this.host.ensureRoomKey(chat.id);
            return encryptRoom(content, roomKey.key, roomKey.epoch);
        }
        return encryptDm(content, await this.host.peerKey(chat.name, chat.id), secret);
    }

    async sendMessage(raw: string, options: SendMessageOptions = {}): Promise<void> {
        if (this.sending) {
            throw new Error('Дождитесь отправки предыдущего сообщения');
        }
        const chat = this.writableChat();
        const generation = this.host.generation;
        const content = options.media
            ? MEDIA_PREFIX + JSON.stringify(options.media)
            : raw.replace(/\r\n/g, '\n');
        if (!content.trim()) {
            throw new Error('Введите сообщение');
        }
        this.host.assertConnected();
        this.sending = true;
        try {
            const fingerprint = JSON.stringify([chatKey(chat), content, options.replyToId ?? null]);
            if (this.pendingSend?.fingerprint !== fingerprint) {
                this.pendingSend = {
                    fingerprint,
                    id: options.clientMessageId ?? randomId(),
                };
            }
            const pending = this.pendingSend;
            let receipt: { success?: boolean; id?: number; duplicate?: boolean } | null = null;
            for (let attempt = 0; attempt < 3; attempt++) {
                if (generation !== this.host.generation) {
                    throw new Error('Аккаунт изменился');
                }
                this.host.assertConnected();
                const encrypted = await this.encryptedText(chat, content);
                if (generation !== this.host.generation) {
                    throw new Error('Аккаунт изменился');
                }
                const media = options.media;
                const payload = {
                    ...(chat.isRoom
                        ? { roomId: chat.id, content: encrypted }
                        : { username: chat.name, peerUserId: chat.id, message: encrypted }),
                    ...(options.replyToId ? { replyToId: options.replyToId } : {}),
                    ...(media?.kind === 'voice'
                        ? { voiceKey: media.storageKey, voiceDurationSec: media.durationSec }
                        : {}),
                    ...(media?.kind === 'attachment'
                        ? {
                              attachmentKey: media.storageKey,
                              attachmentMime: 'application/octet-stream',
                              attachmentFilename: 'attachment.bin',
                              attachmentSize: media.sizeBytes + 16,
                          }
                        : {}),
                };
                try {
                    receipt = await this.host.ack('message:send', {
                        ...payload,
                        clientMessageId: pending.id,
                    });
                    break;
                } catch (error) {
                    if (attempt === 2 || !errorText(error).includes('не подтвердил')) {
                        throw error;
                    }
                }
            }
            if (!receipt?.success || !Number.isSafeInteger(receipt.id)) {
                throw new Error('Сообщение не сохранено');
            }
            if (this.pendingSend === pending) {
                this.pendingSend = null;
            }
            this.typing(false);
            if (
                this.host.snapshot.currentChat &&
                chatKey(this.host.snapshot.currentChat) === chatKey(chat) &&
                (!this.host.snapshot.messages.some((message) => message.id === receipt!.id) ||
                    receipt.duplicate)
            ) {
                await this.reloadHistory();
            }
        } finally {
            this.sending = false;
        }
    }

    async editMessage(id: number, raw: string): Promise<void> {
        const chat = this.writableChat();
        const message = this.host.snapshot.messages.find((item) => item.id === id);
        if (!message?.me || message.isThreadOp || message.media) {
            throw new Error('Можно редактировать только свои текстовые сообщения');
        }
        const content = raw.replace(/\r\n/g, '\n');
        if (!content.trim()) {
            throw new Error('Сообщение не может быть пустым');
        }
        const generation = this.host.generation;
        const encrypted = await this.encryptedText(chat, content);
        if (this.host.generation !== generation) {
            throw new Error('Аккаунт изменился');
        }
        await this.host.waitEvent<WireMessage>(
            'message:edited',
            (data) => data.id === id,
            () =>
                this.host.emit('message:edit', {
                    id,
                    content: encrypted,
                    ...(chat.isRoom
                        ? { roomId: chat.id }
                        : { username: chat.name, peerUserId: chat.id }),
                }),
        );
    }

    async deleteMessage(id: number): Promise<void> {
        const chat = this.writableChat();
        const message = this.host.snapshot.messages.find((item) => item.id === id);
        if (!message?.me || id <= 0) {
            throw new Error('Можно удалить только своё сообщение');
        }
        await this.host.waitEvent<{ id: number }>(
            'message:deleted',
            (data) => data.id === id,
            () =>
                this.host.emit('message:delete', {
                    id,
                    ...(chat.isRoom ? { roomId: chat.id } : { peerUserId: chat.id }),
                }),
        );
    }

    async react(id: number, emoji: string): Promise<void> {
        const chat = this.writableChat();
        const username = this.host.assertSession().user.username;
        await this.host.waitEvent<{ messageId: number; username: string; emoji: string }>(
            'message:reaction',
            (data) => data.messageId === id && data.username === username && data.emoji === emoji,
            () =>
                this.host.emit('message:react', {
                    messageId: id,
                    emoji,
                    ...(chat.isRoom ? { roomId: chat.id } : { peerUserId: chat.id }),
                }),
        );
    }

    async pin(id: number | null): Promise<void> {
        const chat = this.writableChat();
        await this.host.waitEvent<{
            roomId?: number;
            dmPeer?: string;
            peerUserId?: number;
            messageId: number | null;
        }>(
            chat.isRoom ? 'room:pinChanged' : 'dm:pinChanged',
            (data) =>
                data.messageId === id &&
                (chat.isRoom ? data.roomId === chat.id : data.peerUserId === chat.id),
            () =>
                this.host.emit(chat.isRoom ? 'room:setPin' : 'dm:setPin', {
                    messageId: id,
                    ...(chat.isRoom
                        ? { roomId: chat.id }
                        : { dmUsername: chat.name, peerUserId: chat.id }),
                }),
        );
    }

    async readers(messageId: number): Promise<string[]> {
        const chat = this.writableChat();
        if (!chat.isRoom) {
            return [];
        }
        return (
            await this.host.ack<{ readers: string[] }>('message:getRoomReaders', {
                roomId: chat.id,
                messageId,
            })
        ).readers;
    }

    search(query: string): Message[] {
        const normalized = query.trim().toLocaleLowerCase();
        return normalized
            ? this.host.snapshot.messages.filter(
                  (message) =>
                      !message.decryptError &&
                      message.text.toLocaleLowerCase().includes(normalized),
              )
            : this.host.snapshot.messages;
    }

    async setWallpaper(state: Wallpaper): Promise<void> {
        const chat = this.writableChat();
        if (chat.isRoom) {
            throw new Error('Обои доступны в личной переписке');
        }
        await this.host.ack('dmWallpaper:set', {
            peerUsername: chat.name,
            peerUserId: chat.id,
            state,
        });
        if (
            this.host.snapshot.currentChat?.id === chat.id &&
            !this.host.snapshot.currentChat.isRoom
        ) {
            this.host.update({ wallpaper: state });
        }
    }
}
