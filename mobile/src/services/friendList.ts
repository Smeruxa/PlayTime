import type { Friend } from '../types';

export type FriendListEntry = Omit<Friend, 'friend_id'> & {
    friend_id: number | null;
    other_user_id?: number;
};

export function normalizeFriendList(entries: FriendListEntry[], userId: number): Friend[] {
    return entries.flatMap((entry) => {
        if (entry.is_room || (entry.user_id !== userId && entry.friend_id !== userId)) {
            return [];
        }
        const peerId = entry.user_id === userId ? entry.friend_id : entry.user_id;
        if (
            peerId === null ||
            !Number.isSafeInteger(peerId) ||
            peerId <= 0 ||
            peerId === userId ||
            (entry.other_user_id !== undefined && entry.other_user_id !== peerId)
        ) {
            return [];
        }
        return [{ ...entry, friend_id: peerId }];
    });
}
