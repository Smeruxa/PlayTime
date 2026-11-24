import type { FeatureHost } from './featureHost';
import type { ChatRef, RoomDetail } from '../types';

export class RoomService {
    constructor(private host: FeatureHost) {}

    async createRoom(name: string): Promise<ChatRef> {
        const normalized = name.trim();
        if (normalized.length < 3 || normalized.length > 15) {
            throw new Error('Название комнаты: от 3 до 15 символов');
        }
        const result = await this.host.ack<{ roomId: number; name: string }>('room:create', {
            name: normalized,
        });
        await this.host.refreshHome();
        return {
            id: result.roomId,
            name: result.name ?? normalized,
            isRoom: true,
            createdBy: this.host.assertSession().user.id,
        };
    }

    async updateRoom(roomId: number, patch: { name: string }): Promise<void> {
        await this.host.ack('room:rename', { roomId, name: patch.name.trim() });
        if (
            this.host.snapshot.currentChat?.isRoom &&
            this.host.snapshot.currentChat.id === roomId
        ) {
            this.host.update({
                currentChat: { ...this.host.snapshot.currentChat, name: patch.name.trim() },
            });
        }
        await this.host.refreshHome();
    }

    roomMembers(roomId: number): Promise<RoomDetail> {
        return this.host.ack('room:get', { roomId });
    }

    async addRoomMembers(roomId: number, usernames: string[]): Promise<void> {
        for (const username of [...new Set(usernames)]) {
            await this.host.ack('room:addMember', { roomId, username });
        }
        await this.host.refreshHome();
    }

    async removeRoomMember(roomId: number, userId: number): Promise<void> {
        await this.host.ack('room:removeMember', { roomId, userId });
    }

    async setRoomRole(roomId: number, userId: number, role: 'member' | 'moderator'): Promise<void> {
        await this.host.ack('room:setRole', { roomId, userId, role });
    }

    async transferRoomOwnership(roomId: number, userId: number): Promise<void> {
        await this.host.ack('room:transferOwnership', { roomId, userId });
        await this.host.refreshHome();
    }

    async leaveRoom(roomId: number): Promise<void> {
        await this.host.ack('room:leaveRoom', { roomId });
        if (
            this.host.snapshot.currentChat?.isRoom &&
            this.host.snapshot.currentChat.id === roomId
        ) {
            this.host.closeChat();
        }
        await this.host.vault.forgetRoom(roomId);
        await this.host.refreshHome();
    }

    async deleteRoom(roomId: number): Promise<void> {
        await this.host.ack('room:delete', { roomId });
        if (
            this.host.snapshot.currentChat?.isRoom &&
            this.host.snapshot.currentChat.id === roomId
        ) {
            this.host.closeChat();
        }
        await this.host.vault.forgetRoom(roomId);
        await this.host.refreshHome();
    }
}
