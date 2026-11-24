import type { FeatureHost } from './featureHost';
import type { PeerIdentity } from './peerIdentity';
import nacl from 'tweetnacl';
import {
    b64,
    publicKey,
    decodeKey,
    roomKeyName,
    encryptDmBytes,
    decryptDmBytes,
    type RoomKey,
} from './crypto';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
type RoomBundle = {
    epoch?: number;
    currentEpoch?: number;
    members: { id: number; username: string; dmPublicKey: string | null }[];
    wrapCount: number;
    myWrap: { ciphertext: string; wrapperDmPublicKey: string; wrapperUserId?: number } | null;
};

export class RoomKeys {
    constructor(private host: FeatureHost, private peers: PeerIdentity) {}

    private async validateMember(
        id: number,
        key: string,
        username: string,
        historical = false,
    ): Promise<void> {
        if (id === this.host.assertSession().user.id) {
            if (publicKey(this.host.assertEncryption()) !== key) {
                throw new Error('Ключ аккаунта изменился');
            }
            return;
        }
        await this.peers.checkPeerIdentity(username, id, key, historical);
    }

    async ensureRoomKey(roomId: number, requestedEpoch?: number): Promise<RoomKey> {
        const generation = this.host.generation;
        const revision = this.host.vault.roomRevision(roomId);
        const assertAccess = () => {
            if (generation !== this.host.generation) {
                throw new Error('Аккаунт изменился');
            }
            if (this.host.vault.roomRevision(roomId) !== revision) {
                throw new Error('Нет доступа к комнате');
            }
        };
        const secret = this.host.assertEncryption();
        if (requestedEpoch !== undefined) {
            if (!Number.isSafeInteger(requestedEpoch) || requestedEpoch < 0) {
                throw new Error('Некорректная версия ключа');
            }
            const cached = this.host.vault.read(roomKeyName(roomId, requestedEpoch));
            if (cached) {
                return { epoch: requestedEpoch, key: cached };
            }
        }
        for (let attempt = 0; attempt < 3; attempt++) {
            assertAccess();
            const bundle = await this.host.ack<RoomBundle>('room:e2eeBundle', {
                roomId,
                epoch: requestedEpoch,
                keyProtocol: 1,
            });
            assertAccess();
            const epoch = bundle.epoch ?? 0;
            if (requestedEpoch !== undefined && requestedEpoch !== epoch) {
                throw new Error('Ключ истории недоступен');
            }
            const slot = roomKeyName(roomId, epoch);
            const cached = this.host.vault.read(slot);
            if (cached) {
                return { epoch, key: cached };
            }
            let bytes: Uint8Array;
            if (bundle.myWrap) {
                const wrap = bundle.myWrap;
                const sender =
                    wrap.wrapperUserId === undefined
                        ? bundle.members.find(
                              (member) => member.dmPublicKey === wrap.wrapperDmPublicKey,
                          )
                        : bundle.members.find((member) => member.id === wrap.wrapperUserId);
                const historical =
                    requestedEpoch !== undefined && epoch < (bundle.currentEpoch ?? epoch);
                if (!historical && (!sender || sender.dmPublicKey !== wrap.wrapperDmPublicKey)) {
                    throw new Error('Ключ участника, передавшего ключ комнаты, изменился');
                }
                try {
                    bytes = decryptDmBytes(wrap.ciphertext, wrap.wrapperDmPublicKey, secret);
                    if (bytes.length !== 32) {
                        throw new Error('Некорректный ключ комнаты');
                    }
                } catch {
                    throw new Error(
                        'Старый ключ комнаты недоступен. Восстановите копию ключей или попросите участника удалить вас из комнаты и пригласить заново.',
                    );
                }
                await this.validateMember(
                    wrap.wrapperUserId ?? sender?.id ?? 0,
                    wrap.wrapperDmPublicKey,
                    sender?.username ?? String(wrap.wrapperUserId),
                    historical,
                );
            } else if (!bundle.wrapCount && requestedEpoch === undefined) {
                bytes = nacl.randomBytes(32);
                const wraps: Record<string, string> = {};
                for (const member of bundle.members) {
                    if (!member.dmPublicKey) {
                        continue;
                    }
                    await this.validateMember(member.id, member.dmPublicKey, member.username);
                    wraps[member.id] = encryptDmBytes(bytes, member.dmPublicKey, secret);
                }
                assertAccess();
                try {
                    await this.host.ack('room:e2eePutWraps', { roomId, wraps, epoch });
                } catch (error) {
                    if (attempt === 2) {
                        throw error;
                    }
                    continue;
                }
            } else if (requestedEpoch === undefined && attempt < 2) {
                await delay(700);
                continue;
            } else {
                throw new Error('Ключ комнаты пока недоступен');
            }
            assertAccess();
            const key = b64(bytes);
            await this.host.vault.write(slot, key);
            assertAccess();
            return { epoch, key };
        }
        throw new Error('Не удалось получить ключ комнаты');
    }

    async wrapForNewMember(roomId: number, userId: number): Promise<void> {
        const generation = this.host.generation;
        const secret = this.host.vault.read('dm');
        if (!secret || userId === this.host.snapshot.session?.user.id) {
            return;
        }
        const bundle = await this.host.ack<RoomBundle>('room:e2eeBundle', {
            roomId,
            keyProtocol: 1,
        });
        if (generation !== this.host.generation) {
            return;
        }
        if (!bundle.wrapCount) {
            await this.ensureRoomKey(roomId);
            return;
        }
        const member = bundle.members.find((item) => item.id === userId);
        const epoch = bundle.epoch ?? 0;
        if (!member?.dmPublicKey || !bundle.myWrap) {
            return;
        }
        const { key } = await this.ensureRoomKey(roomId, epoch);
        if (generation !== this.host.generation) {
            return;
        }
        await this.validateMember(member.id, member.dmPublicKey, member.username);
        if (generation !== this.host.generation) {
            return;
        }
        try {
            await this.host.ack('room:e2eePutWraps', {
                roomId,
                epoch,
                wraps: { [userId]: encryptDmBytes(decodeKey(key), member.dmPublicKey, secret) },
            });
        } catch (error) {
            if (!(error instanceof Error && error.message.includes('уже есть'))) {
                throw error;
            }
        }
    }
}
