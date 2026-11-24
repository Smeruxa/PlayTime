import { nativeBridge } from './nativeBridge';
import { environmentKey } from './storageScope';

async function secureService(key: string): Promise<string> {
    const native = await nativeBridge();
    return `com.playtime.mobile.${environmentKey(native.apiBase, key)}`;
}

export interface SecureStorage {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
}

export const deviceStorage: SecureStorage = {
    async get(key) {
        const Keychain = await import('react-native-keychain');
        const result = await Keychain.getGenericPassword({ service: await secureService(key) });
        return result ? result.password : null;
    },
    async set(key, value) {
        const Keychain = await import('react-native-keychain');
        const result = await Keychain.setGenericPassword('playtime', value, {
            service: await secureService(key),
            accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        });
        if (!result) {
            throw new Error('Не удалось сохранить данные в защищённом хранилище Android');
        }
    },
    async remove(key) {
        const Keychain = await import('react-native-keychain');
        await Keychain.resetGenericPassword({ service: await secureService(key) });
    },
};

export class KeyVault {
    private keys: Record<string, string> = {};
    private userId: number | null = null;
    private queue: Promise<void> = Promise.resolve();
    private loadGeneration = 0;
    private accountGeneration = 0;
    private roomRevisions = new Map<number, number>();
    constructor(private storage: SecureStorage) {}
    async load(userId: number): Promise<void> {
        if (this.userId !== null && this.userId !== userId) {
            this.clear();
        }
        const generation = ++this.loadGeneration;
        const work = this.queue
            .catch(() => {})
            .then(async () => {
                const stored = await this.storage.get(`keys.${userId}`);
                if (generation === this.loadGeneration) {
                    this.keys = stored ? JSON.parse(stored) : {};
                    this.userId = userId;
                }
            });
        this.queue = work;
        return work;
    }
    read(name: string): string | undefined {
        return this.keys[name];
    }
    snapshot(): Record<string, string> {
        return { ...this.keys };
    }
    clear(): void {
        this.loadGeneration++;
        this.accountGeneration++;
        this.keys = {};
        this.userId = null;
        this.roomRevisions.clear();
    }
    roomRevision(roomId: number): number {
        return this.roomRevisions.get(roomId) ?? 0;
    }

    forgetRoom(roomId: number): Promise<void> {
        this.roomRevisions.set(roomId, this.roomRevision(roomId) + 1);
        const base = `room:${roomId}`;
        return this.mutate((keys) => {
            for (const name of Object.keys(keys)) {
                if (name === base || name.startsWith(base + ':')) {
                    delete keys[name];
                }
            }
            return keys;
        });
    }

    replace(keys: Record<string, string>): Promise<void> {
        const next = { ...keys };
        return this.mutate(() => next);
    }

    write(name: string, value: string | null): Promise<void> {
        return this.mutate((keys) => {
            if (value === null) {
                delete keys[name];
            } else {
                keys[name] = value;
            }
            return keys;
        });
    }

    private async mutate(
        change: (keys: Record<string, string>) => Record<string, string>,
    ): Promise<void> {
        const userId = this.userId;
        const generation = this.accountGeneration;
        if (userId === null) {
            throw new Error('Сначала войдите в аккаунт');
        }
        const work = this.queue
            .catch(() => {})
            .then(async () => {
                if (this.userId !== userId || this.accountGeneration !== generation) {
                    throw new Error('Аккаунт изменился');
                }
                const next = change({ ...this.keys });
                await this.storage.set(`keys.${userId}`, JSON.stringify(next));
                if (this.userId === userId && this.accountGeneration === generation) {
                    this.keys = next;
                }
            });
        this.queue = work;
        return work;
    }
}
