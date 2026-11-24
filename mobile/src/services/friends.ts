import type { FeatureHost } from './featureHost';
import type { FriendAction } from '../types';
import type { FriendListEntry } from './friendList';
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class FriendService {
    constructor(private host: FeatureHost) {}

    async friendAction(action: FriendAction, username: string, peerUserId?: number): Promise<void> {
        const name = username.trim();
        if (!name || name.length > 50) {
            throw new Error('Введите никнейм пользователя');
        }
        if (name === this.host.assertSession().user.username) {
            throw new Error('Нельзя добавить самого себя');
        }
        if (action === 'block') {
            await this.host.safety(name, 'block');
            return;
        }
        if (action === 'request') {
            await this.host.waitEvent<{ username: string }>(
                'friend:request:success',
                (data) => data.username === name,
                () => this.host.emit('friend:request', { friendUsername: name }),
                'friend:request:error',
            );
        } else {
            this.host.emit(`friend:${action}`, {
                friendUsername: name,
                peerUserId:
                    peerUserId ??
                    [
                        ...this.host.snapshot.friends,
                        ...this.host.snapshot.incoming,
                        ...(this.host.snapshot.outgoingPeers ?? []),
                    ].find((friend) => friend.friend_username === name)?.friend_id,
            });
            let confirmed = false;
            for (let attempt = 0; attempt < 8; attempt++) {
                await delay(attempt ? 500 : 120);
                const list = await this.host.ack<FriendListEntry[]>('friend:list');
                const targetId =
                    peerUserId ??
                    [
                        ...this.host.snapshot.friends,
                        ...this.host.snapshot.incoming,
                        ...(this.host.snapshot.outgoingPeers ?? []),
                    ].find((item) => item.friend_username === name)?.friend_id;
                const friend = list.find(
                    (item) =>
                        (targetId
                            ? item.other_user_id === targetId
                            : item.friend_username === name) && !item.is_room,
                );
                confirmed =
                    action === 'accept'
                        ? friend?.status === 'accepted'
                        : action === 'remove'
                        ? friend?.status !== 'accepted'
                        : friend?.status !== 'pending';
                if (confirmed) {
                    break;
                }
            }
            if (!confirmed) {
                throw new Error('Сервер не подтвердил изменение списка друзей. Обновите список.');
            }
        }
        await this.host.refreshHome();
    }
}
