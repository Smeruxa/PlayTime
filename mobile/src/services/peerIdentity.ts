import type { FeatureHost } from './featureHost';
import { decodeKey } from './crypto';

export class PeerIdentity {
    private identityQueue = Promise.resolve();
    constructor(private host: FeatureHost) {}

    private assertGeneration(generation: number): void {
        if (this.host.generation !== generation) {
            throw new Error('Аккаунт изменился');
        }
    }

    private identityOperation<T>(work: () => Promise<T>): Promise<T> {
        const result = this.identityQueue.then(work);
        this.identityQueue = result.then(
            () => {},
            () => {},
        );
        return result;
    }
    async peerKey(username: string, peerUserId?: number): Promise<string> {
        const generation = this.host.generation;
        const { publicKey: key } = await this.host.ack<{ publicKey: string | null }>(
            'profile:getDmPublicKey',
            { username, peerUserId },
        );
        this.assertGeneration(generation);
        if (!key) {
            throw new Error(
                'Собеседник ещё не настроил шифрование. Попросите его войти в PlayTime.',
            );
        }
        return this.checkPeerIdentity(username, peerUserId, key);
    }

    checkPeerIdentity(
        username: string,
        peerUserId: number | undefined,
        key: string,
        historical = false,
    ): Promise<string> {
        const generation = this.host.generation;
        return this.identityOperation(async () => {
            this.assertGeneration(generation);
            const session = this.host.assertSession();
            if (!peerUserId || !Number.isSafeInteger(peerUserId) || peerUserId < 1) {
                throw new Error('Неизвестный владелец ключа');
            }
            decodeKey(key);
            const slot = `trust.${session.user.id}.id:${peerUserId}`;
            const previous = await this.host.storage.get(slot);
            this.assertGeneration(generation);
            if (!previous) {
                await this.host.storage.set(slot, key);
                this.assertGeneration(generation);
            } else if (previous !== key) {
                const archived =
                    historical && (await this.host.storage.get(`${slot}.history.${key}`)) === '1';
                this.assertGeneration(generation);
                if (!archived) {
                    this.host.update({
                        encryption: {
                            ...this.host.snapshot.encryption,
                            changedPeer: { username, peerUserId, previous, key },
                        },
                    });
                    throw new Error(
                        'Ключ собеседника изменился. Сверьте ключ и подтвердите его в разделе Безопасность.',
                    );
                }
            }
            return key;
        });
    }

    trustChangedPeer(expectedKey?: string, expectedPeerId?: number): Promise<void> {
        const session = this.host.assertSession();
        const generation = this.host.generation;
        const change = this.host.snapshot.encryption.changedPeer;
        if (!change) {
            return Promise.resolve();
        }
        return this.identityOperation(async () => {
            this.assertGeneration(generation);
            if (
                (expectedKey && change.key !== expectedKey) ||
                (expectedPeerId !== undefined && expectedPeerId !== change.peerUserId) ||
                this.host.snapshot.encryption.changedPeer?.peerUserId !== change.peerUserId ||
                this.host.snapshot.encryption.changedPeer?.key !== change.key
            ) {
                throw new Error('Ключ собеседника снова изменился. Проверьте новый отпечаток.');
            }
            const slot = `trust.${session.user.id}.id:${change.peerUserId}`;
            await this.host.storage.set(`${slot}.history.${change.previous}`, '1');
            this.assertGeneration(generation);
            await this.host.storage.set(slot, change.key);
            this.assertGeneration(generation);
            this.host.update({
                encryption: { ...this.host.snapshot.encryption, changedPeer: undefined },
            });
        });
    }
}
