import type { FeatureHost } from './featureHost';
import type { Profile, ProfilePatch, DeviceSession, RevocationChallenge } from '../types';
import { confirmationCode } from './confirmationCode';

export class AccountService {
    constructor(private host: FeatureHost) {}

    async getProfile(username?: string, peerUserId?: number): Promise<Profile> {
        const result = await this.host.ack<{ profile: Profile }>(
            'profile:get',
            username ? { username, peerUserId } : {},
        );
        if (!result.profile) {
            throw new Error('Профиль недоступен');
        }
        return result.profile;
    }

    async updateProfile(patch: ProfilePatch): Promise<void> {
        const current = this.host.snapshot.profile ?? (await this.getProfile());
        await this.host.ack('profile:update', {
            status: current.status,
            bio: current.bio,
            ...patch,
        });
        const profile = await this.getProfile();
        this.host.update({ profile });
    }

    async sessions(): Promise<DeviceSession[]> {
        return (await this.host.request<{ sessions: DeviceSession[] }>('/auth/sessions')).sessions;
    }

    requestSessionRevocation(sessionId: string | null): Promise<RevocationChallenge> {
        return this.host.request('/auth/sessions/revocation-code', {
            body: sessionId ? { sessionId } : { allOthers: true },
        });
    }

    async revokeSession(
        sessionId: string | null,
        challengeId: string,
        code: string,
    ): Promise<void> {
        await this.host.request(
            sessionId
                ? `/auth/sessions/${encodeURIComponent(sessionId)}/revoke`
                : '/auth/sessions/revoke-others',
            { body: { challengeId, code: confirmationCode(code) } },
        );
    }

    async changePassword(currentPassword: string, newPassword: string): Promise<void> {
        await this.host.ack('user:changePassword', { currentPassword, newPassword });
        await this.host.clearSession();
    }

    async deleteAccount(password: string): Promise<void> {
        const uid = this.host.assertSession().user.id;
        await this.host.ack('user:deleteAccount', { password });
        await this.host.storage.remove(`keys.${uid}`);
        await this.host.clearSession();
    }

    async blockedUsers(): Promise<string[]> {
        return (await this.host.request<{ usernames: string[] }>('/peers/blocked')).usernames;
    }

    async safety(
        username: string,
        action: 'block' | 'unblock' | 'report',
        reason?: string,
        peerUserId?: number,
    ): Promise<void> {
        await this.host.request(`/peers/${encodeURIComponent(username)}/${action}`, {
            body: {
                reason,
                peerUserId:
                    peerUserId ??
                    (this.host.snapshot.currentChat?.name === username &&
                    !this.host.snapshot.currentChat.isRoom
                        ? this.host.snapshot.currentChat.id
                        : [...this.host.snapshot.friends, ...this.host.snapshot.incoming].find(
                              (friend) => friend.friend_username === username,
                          )?.friend_id),
            },
        });
        if (
            action === 'block' &&
            !this.host.snapshot.currentChat?.isRoom &&
            this.host.snapshot.currentChat?.name === username
        ) {
            this.host.closeChat();
        }
        await this.host.refreshHome();
    }
}
