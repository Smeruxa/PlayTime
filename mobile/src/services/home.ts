import type { FeatureHost } from './featureHost';
import type { Room, Friend, ClientSnapshot, Subscription } from '../types';
import { ApiError } from './http';
import { roomEpoch, roomKeyName } from './crypto';
import { chatKey } from './chatIdentity';
import { normalizeFriendList, type FriendListEntry } from './friendList';
type PreviewsWire = {
    dm: Record<
        string,
        {
            sender_id?: number;
            from: string;
            content: string;
            senderDmPublicKey?: string;
            receiverDmPublicKey?: string;
        }
    >;
    dmByUserId?: PreviewsWire['dm'];
    dmUnreadByUserId?: Record<string, number>;
    rooms: Record<string, { from: string; content: string }>;
    dmUnread: Record<string, number>;
    roomUnread: Record<string, number>;
};

export class HomeService {
    private homeRequest: Promise<void> | null = null;
    private refreshRequested = false;
    constructor(private host: FeatureHost) {}
    reset(): void {
        this.homeRequest = null;
        this.refreshRequested = false;
    }
    async refreshHome(): Promise<void> {
        this.refreshRequested = true;
        if (this.homeRequest) {
            return this.homeRequest;
        }
        const generation = this.host.generation;
        const work = this.drainHomeRequests(generation);
        this.homeRequest = work;
        try {
            await work;
        } finally {
            if (this.homeRequest === work) {
                this.homeRequest = null;
            }
        }
    }

    private async drainHomeRequests(generation: number): Promise<void> {
        let failure: unknown;
        do {
            this.refreshRequested = false;
            failure = undefined;
            try {
                await this.refreshSnapshot(generation);
            } catch (error) {
                failure = error;
                if (error instanceof ApiError && [401, 403].includes(error.status)) {
                    throw error;
                }
            }
        } while (this.refreshRequested && generation === this.host.generation);
        if (failure && generation === this.host.generation) {
            throw failure;
        }
    }

    private async refreshSnapshot(generation: number): Promise<void> {
        const userId = this.host.assertSession().user.id;
        const errors: unknown[] = [];
        let onlineIds: number[] | null = null;
        const current = () => generation === this.host.generation;
        const updateOnline = () => {
            if (onlineIds) {
                this.host.update({
                    online: this.host.snapshot.friends
                        .filter(
                            (friend) =>
                                !friend.friend_archived && onlineIds!.includes(friend.friend_id),
                        )
                        .map((friend) => friend.friend_username),
                });
            }
        };
        const jobs: (() => Promise<void>)[] = [
            async () => {
                const rows = await this.host.ack<FriendListEntry[]>('friend:list');
                if (!Array.isArray(rows)) {
                    throw new Error('Некорректный список друзей');
                }
                if (!current()) {
                    return;
                }
                this.applyPeers(normalizeFriendList(rows, userId));
                updateOnline();
            },
            async () => {
                const subscription = await this.host.request<Subscription>('/subscription/me');
                if (
                    !subscription ||
                    typeof subscription.planSlug !== 'string' ||
                    !subscription.limits ||
                    typeof subscription.limits !== 'object' ||
                    Array.isArray(subscription.limits)
                ) {
                    throw new Error('Некорректный ответ о тарифе');
                }
                if (current()) {
                    this.host.update({ subscription });
                }
            },
            async () => {
                const rooms = await this.host.ack<Room[]>('room:list');
                if (!Array.isArray(rooms)) {
                    throw new Error('Некорректный список комнат');
                }
                if (current()) {
                    this.applyRooms(rooms);
                }
            },
            async () => {
                const profile = await this.host.getProfile();
                if (
                    !profile ||
                    typeof profile !== 'object' ||
                    typeof profile.username !== 'string'
                ) {
                    throw new Error('Некорректный профиль');
                }
                if (current()) {
                    this.host.update({ profile });
                }
            },
            async () => {
                const avatars = await this.host.ack<ClientSnapshot['avatars']>(
                    'profile:friendsAvatars',
                    {},
                );
                if (!avatars || typeof avatars !== 'object' || Array.isArray(avatars)) {
                    throw new Error('Некорректный ответ с аватарами');
                }
                if (current()) {
                    this.host.update({ avatars });
                }
            },
            async () => {
                const ids = await this.host.ack<number[]>('presence:listByUserId');
                if (!Array.isArray(ids) || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
                    throw new Error('Некорректный список пользователей в сети');
                }
                if (!current()) {
                    return;
                }
                onlineIds = ids;
                updateOnline();
            },
        ];
        let next = 0;
        const worker = async () => {
            while (current() && next < jobs.length) {
                const job = jobs[next++];
                try {
                    await this.retry(job, generation);
                } catch (error) {
                    if (current()) {
                        errors.push(error);
                    }
                }
            }
        };
        await Promise.all([worker(), worker()]);
        if (!current()) {
            return;
        }
        try {
            await this.retry(() => this.loadPreviews(), generation);
        } catch (error) {
            if (current()) {
                errors.push(error);
            }
        }
        if (!current()) {
            return;
        }
        const authenticationFailure = errors.find(
            (error) => error instanceof ApiError && [401, 403].includes(error.status),
        );
        if (authenticationFailure) {
            throw authenticationFailure;
        }
        if (errors.length) {
            throw errors[0];
        }
    }

    private async retry(work: () => Promise<void>, generation: number): Promise<void> {
        for (let attempt = 0; generation === this.host.generation; attempt++) {
            try {
                await work();
                return;
            } catch (error) {
                const transient =
                    error instanceof ApiError
                        ? error.status === 429 || error.status >= 500
                        : error instanceof Error &&
                          /обрабатывает ваши запросы|не подтвердил|нет соединения|не ответил вовремя|не удалось соединиться/i.test(
                              error.message,
                          );
                if (attempt >= 2 || !transient || generation !== this.host.generation) {
                    throw error;
                }
                await new Promise<void>((resolve) => setTimeout(resolve, [150, 400][attempt]));
            }
        }
    }

    private applyPeers(peers: Friend[]): void {
        this.host.update({
            friends: peers.filter((friend) => friend.status === 'accepted'),
            incoming: peers.filter(
                (friend) => friend.status === 'pending' && friend.direction === 'incoming',
            ),
            outgoing: peers
                .filter((friend) => friend.status === 'pending' && friend.direction === 'outgoing')
                .map((friend) => friend.friend_username),
            outgoingPeers: peers.filter(
                (friend) => friend.status === 'pending' && friend.direction === 'outgoing',
            ),
        });
        const chat = this.host.snapshot.currentChat;
        if (!chat || chat.isRoom) {
            return;
        }
        const peer = peers.find(
            (friend) => friend.friend_id === chat.id && friend.status === 'accepted',
        );
        if (!peer) {
            this.host.closeChat();
        } else {
            this.host.update({ currentChat: { ...chat, archived: !!peer.friend_archived } });
        }
    }

    private applyRooms(rooms: Room[]): void {
        this.host.update({ rooms });
        const chat = this.host.snapshot.currentChat;
        if (!chat?.isRoom) {
            return;
        }
        const room = rooms.find((item) => item.id === chat.id);
        if (!room) {
            this.host.closeChat();
        } else if (chat.name !== room.name || chat.createdBy !== room.created_by) {
            this.host.update({
                currentChat: { ...chat, name: room.name, createdBy: room.created_by },
            });
        }
    }

    async loadPreviews(): Promise<void> {
        const generation = this.host.generation;
        const result = await this.host.ack<PreviewsWire>('message:lastPreviews');
        if (generation !== this.host.generation) {
            return;
        }
        const previews = { ...this.host.snapshot.previews };
        for (const [name, wire] of Object.entries(result.dmByUserId ?? {})) {
            if (generation !== this.host.generation) {
                return;
            }
            const peer = this.host.snapshot.friends.find(
                (friend) => friend.friend_id === Number(name),
            );
            if (!peer) {
                continue;
            }
            const chat = { id: peer.friend_id, name: peer.friend_username, isRoom: false };
            const message = await this.host.decode(
                {
                    id: 0,
                    content: wire.content,
                    sender_username: wire.from,
                    sender_id: wire.sender_id,
                    senderDmPublicKey: wire.senderDmPublicKey,
                    receiverDmPublicKey: wire.receiverDmPublicKey,
                },
                chat,
                'preview',
            );
            previews[chatKey(chat)] = {
                text: message.text,
                date: previews[chatKey(chat)]?.date ?? 0,
                me: message.me,
                unread: result.dmUnreadByUserId?.[name] ?? 0,
            };
        }
        for (const [id, wire] of Object.entries(result.rooms ?? {})) {
            if (generation !== this.host.generation) {
                return;
            }
            const chat = { id: Number(id), name: '', isRoom: true };
            const message = await this.host.decode(
                { id: 0, content: wire.content, from: wire.from, roomId: Number(id) },
                chat,
                'preview',
            );
            previews[chatKey(chat)] = {
                text:
                    message.decryptError &&
                    !this.host.vault.read(roomKeyName(chat.id, roomEpoch(wire.content)))
                        ? 'Зашифрованное сообщение'
                        : message.text,
                date: previews[chatKey(chat)]?.date ?? 0,
                me: message.me,
                unread: result.roomUnread?.[id] ?? 0,
            };
        }
        if (generation === this.host.generation) {
            this.host.update({ previews });
        }
    }
}
