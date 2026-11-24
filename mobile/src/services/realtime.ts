import type { Socket } from 'socket.io-client';
import type { FeatureHost } from './featureHost';
import type { ChatRef, Wallpaper } from '../types';
import { mergeMessages, messageMatches, type WireMessage } from './messages';
import { chatKey } from './chatIdentity';
export interface RealtimeHost extends FeatureHost {
    readonly pendingWaits: Set<(error: Error) => void>;
    prepareEncryption(): Promise<void>;
    refreshAccess(): Promise<boolean>;
    loadPreviews(): Promise<void>;
    wrapForNewMember(roomId: number, userId: number): Promise<void>;
    markRead(): void;
}
export class RealtimeEvents {
    private connectionRevision = 0;
    private typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
    constructor(private host: RealtimeHost) {}
    clearTimers(): void {
        this.connectionRevision++;
        for (const timer of this.typingTimers.values()) {
            clearTimeout(timer);
        }
        this.typingTimers.clear();
    }
    attach(socket: Socket): void {
        socket.on('connect', () => {
            this.host.update({ connection: 'online', error: null });
            const generation = this.host.generation;
            const revision = ++this.connectionRevision;
            const current = () =>
                generation === this.host.generation &&
                revision === this.connectionRevision &&
                socket.connected;
            const report = (error: unknown) => {
                if (current()) {
                    this.host.report(error);
                }
            };
            void Promise.all([
                this.host.prepareEncryption().catch(report),
                this.host.refreshHome().catch(report),
            ]).then(() => {
                if (current() && this.host.snapshot.currentChat) {
                    return this.host.reloadHistory().catch(report);
                }
            });
        });
        socket.on('disconnect', () => {
            this.connectionRevision++;
            this.host.update({ connection: 'offline', typingUsers: [], historyLoading: false });
            for (const cancel of [...this.host.pendingWaits]) {
                cancel(new Error('Соединение прервано. Повторите действие после подключения.'));
            }
        });
        socket.on('connect_error', (error: Error) => {
            this.host.update({ connection: 'offline' });
            if (/auth|jwt|unauthor|forbidden|expired/i.test(error.message)) {
                void this.host.refreshAccess();
            }
        });
        socket.on('session:revoked', () => {
            void this.host.clearSession().catch((error) => this.host.report(error));
        });
        socket.on('session:expired', () => {
            void this.host.refreshAccess();
        });
        const reloadHome = () => {
            void this.host.refreshHome().catch((error) => this.host.report(error));
        };
        for (const event of [
            'friend:list:updated',
            'friend:request',
            'friend:accept',
            'friend:decline',
            'friend:remove',
            'friend:block',
            'room:invite',
            'room:renamed',
            'profile:updated',
            'subscription:planChanged',
        ]) {
            socket.on(event, reloadHome);
        }
        socket.on('room:removed', (data: { roomId: number }) => {
            if (
                this.host.snapshot.currentChat?.isRoom &&
                this.host.snapshot.currentChat.id === data.roomId
            ) {
                this.host.closeChat();
            }
            void this.host.vault.forgetRoom(data.roomId).catch((error) => this.host.report(error));
            reloadHome();
        });
        socket.on('room:membersChanged', (data: { roomId: number }) => {
            reloadHome();
            if (
                this.host.snapshot.currentChat?.isRoom &&
                this.host.snapshot.currentChat.id === data.roomId
            ) {
                void this.host.reloadHistory().catch((error) => this.host.report(error));
            }
        });
        socket.on('room:e2eeNeedWrap', (data: { roomId: number; newUserId: number }) => {
            void this.host
                .wrapForNewMember(data.roomId, data.newUserId)
                .catch((error) => this.host.report(error));
        });
        socket.on(
            'presence:changed',
            (data: { username: string; userId?: number; online: boolean }) => {
                if (
                    !this.host.snapshot.friends.some(
                        (friend) => friend.friend_id === data.userId && !friend.friend_archived,
                    )
                ) {
                    return;
                }
                this.host.update({
                    online: data.online
                        ? [...new Set([...this.host.snapshot.online, data.username])]
                        : this.host.snapshot.online.filter((name) => name !== data.username),
                });
            },
        );
        socket.on('message:receive', (data: WireMessage) => this.receiveMessage(data));
        socket.on('message:send:success', (data: WireMessage) => this.receiveMessage(data));
        socket.on('message:edited', async (data: WireMessage) => {
            const generation = this.host.generation;
            const chat = this.host.snapshot.currentChat;
            if (
                !chat ||
                !messageMatches(data, chat, this.host.snapshot.session?.user.username ?? '')
            ) {
                return;
            }
            const old = this.host.snapshot.messages.find((message) => message.id === data.id);
            if (!old) {
                return;
            }
            const next = await this.host.decode(
                {
                    ...data,
                    sender_username: data.sender_username ?? old.from,
                    me: old.me,
                    created_at: new Date(old.data).toISOString(),
                },
                chat,
            );
            if (generation !== this.host.generation || this.host.snapshot.currentChat !== chat) {
                return;
            }
            this.host.update({
                messages: this.host.snapshot.messages.map((message) =>
                    message.id === data.id
                        ? { ...old, ...next, reply: old.reply, reactions: old.reactions }
                        : message,
                ),
            });
        });
        socket.on('message:deleted', (data: { id: number; roomId?: number }) => {
            this.host.update({
                messages: this.host.snapshot.messages.filter((message) => message.id !== data.id),
                ...(this.host.snapshot.pinnedMessageId === data.id
                    ? { pinnedMessageId: null }
                    : {}),
            });
            void this.host.loadPreviews().catch(() => {});
        });
        socket.on(
            'message:reaction',
            (data: { messageId: number; emoji: string; username: string; active: boolean }) => {
                this.host.update({
                    messages: this.host.snapshot.messages.map((message) => {
                        if (message.id !== data.messageId) {
                            return message;
                        }
                        const reactions = message.reactions.filter(
                            (reaction) => reaction.emoji !== data.emoji,
                        );
                        const users = (
                            message.reactions.find((reaction) => reaction.emoji === data.emoji)
                                ?.users ?? []
                        ).filter((name) => name !== data.username);
                        if (data.active) {
                            users.push(data.username);
                        }
                        if (users.length) {
                            reactions.push({ emoji: data.emoji, users });
                        }
                        return { ...message, reactions };
                    }),
                });
            },
        );
        socket.on(
            'message:read',
            (data: { readerUsername: string; readerUserId?: number; messageIds: number[] }) => {
                if (
                    this.host.snapshot.currentChat?.isRoom ||
                    this.host.snapshot.currentChat?.id !== data.readerUserId
                ) {
                    return;
                }
                const ids = new Set(data.messageIds);
                this.host.update({
                    messages: this.host.snapshot.messages.map((message) =>
                        ids.has(message.id) ? { ...message, read: true } : message,
                    ),
                });
            },
        );
        socket.on('room:pinChanged', (data: { roomId: number; messageId: number | null }) => {
            if (
                this.host.snapshot.currentChat?.isRoom &&
                this.host.snapshot.currentChat.id === data.roomId
            ) {
                this.host.update({ pinnedMessageId: data.messageId });
            }
        });
        socket.on(
            'dm:pinChanged',
            (data: { dmPeer: string; peerUserId?: number; messageId: number | null }) => {
                if (
                    !this.host.snapshot.currentChat?.isRoom &&
                    this.host.snapshot.currentChat?.id === data.peerUserId
                ) {
                    this.host.update({ pinnedMessageId: data.messageId });
                }
            },
        );
        socket.on(
            'chat:typing',
            (data: {
                fromUsername: string;
                roomId?: number;
                dmPeer?: string;
                peerUserId?: number;
                fromUserId?: number;
                typing: boolean;
            }) => {
                const chat = this.host.snapshot.currentChat;
                if (
                    !chat ||
                    data.fromUsername === this.host.snapshot.session?.user.username ||
                    (chat.isRoom ? data.roomId !== chat.id : data.peerUserId !== chat.id)
                ) {
                    return;
                }
                const old = this.typingTimers.get(data.fromUsername);
                if (old) {
                    clearTimeout(old);
                }
                const names = this.host.snapshot.typingUsers.filter(
                    (name) => name !== data.fromUsername,
                );
                if (data.typing) {
                    names.push(data.fromUsername);
                    this.typingTimers.set(
                        data.fromUsername,
                        setTimeout(
                            () =>
                                this.host.update({
                                    typingUsers: this.host.snapshot.typingUsers.filter(
                                        (name) => name !== data.fromUsername,
                                    ),
                                }),
                            4500,
                        ),
                    );
                }
                this.host.update({ typingUsers: names });
            },
        );
        socket.on(
            'dmWallpaper:update',
            (data: { peerUsername: string; peerUserId?: number; state: Wallpaper }) => {
                if (
                    !this.host.snapshot.currentChat?.isRoom &&
                    this.host.snapshot.currentChat?.id === data.peerUserId
                ) {
                    this.host.update({ wallpaper: data.state });
                }
            },
        );
        socket.on(
            'dmThreadOp:new',
            (data: {
                peerUsername: string;
                peerUserId?: number;
                op: { id: number; text: string; created_at: string };
            }) => {
                if (
                    !this.host.snapshot.currentChat?.isRoom &&
                    this.host.snapshot.currentChat?.id === data.peerUserId &&
                    data.op
                ) {
                    this.host.update({
                        messages: mergeMessages(this.host.snapshot.messages, [
                            {
                                id: data.op.id,
                                text: data.op.text,
                                data: Date.parse(data.op.created_at),
                                me: false,
                                from: '',
                                read: true,
                                reactions: [],
                                isThreadOp: true,
                            },
                        ]),
                    });
                }
            },
        );
    }
    async receiveMessage(data: WireMessage): Promise<void> {
        const generation = this.host.generation;
        const username = this.host.snapshot.session?.user.username;
        if (!username) {
            return;
        }
        const chat: ChatRef =
            data.roomId != null
                ? {
                      id: data.roomId,
                      name:
                          this.host.snapshot.rooms.find((room) => room.id === data.roomId)?.name ??
                          '',
                      isRoom: true,
                  }
                : {
                      id:
                          data.sender_id === this.host.snapshot.session?.user.id
                              ? data.receiver_id ?? 0
                              : data.sender_id ?? 0,
                      name:
                          data.sender_username === username
                              ? data.receiver_username ?? ''
                              : data.sender_username ?? '',
                      isRoom: false,
                  };
        if ((!chat.name || chat.id <= 0) && !chat.isRoom) {
            return;
        }
        const message = await this.host.decode(data, chat);
        if (generation !== this.host.generation) {
            return;
        }
        const key = chatKey(chat);
        const isCurrent =
            this.host.snapshot.currentChat && chatKey(this.host.snapshot.currentChat) === key;
        const previews = {
            ...this.host.snapshot.previews,
            [key]: {
                text: message.text,
                date: message.data,
                me: message.me,
                unread:
                    message.me || (isCurrent && this.host.foreground && this.host.chatVisible)
                        ? 0
                        : (this.host.snapshot.previews[key]?.unread ?? 0) + 1,
            },
        };
        this.host.update({
            previews,
            ...(isCurrent
                ? { messages: mergeMessages(this.host.snapshot.messages, [message]) }
                : {}),
        });
        if (isCurrent && this.host.foreground && this.host.chatVisible) {
            this.host.markRead();
        }
    }
}
