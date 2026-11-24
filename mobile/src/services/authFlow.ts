import type { SecureStorage } from './storage';

export type AuthFlowDraft = {
    mode: 'register' | 'verify';
    email: string;
    username: string;
    resendAt: number;
};

const KEY = 'auth.pending';
const LIFETIME = 24 * 60 * 60 * 1000;

export class AuthFlowStore {
    private writes: Promise<void> = Promise.resolve();
    private generation = 0;

    constructor(private storage: SecureStorage) {}

    async load(): Promise<AuthFlowDraft | null> {
        const generation = this.generation;
        await this.writes;
        const raw = await this.storage.get(KEY);
        if (generation !== this.generation || !raw) {
            return null;
        }
        try {
            const value: unknown = JSON.parse(raw);
            if (!value || typeof value !== 'object') {
                throw new Error('Invalid authentication draft');
            }
            const draft = value as Record<string, unknown>;
            const now = Date.now();
            if (
                draft.version !== 1 ||
                (draft.mode !== 'register' && draft.mode !== 'verify') ||
                typeof draft.email !== 'string' ||
                draft.email.length > 254 ||
                typeof draft.username !== 'string' ||
                draft.username.length > 15 ||
                typeof draft.resendAt !== 'number' ||
                !Number.isFinite(draft.resendAt) ||
                draft.resendAt < 0 ||
                draft.resendAt > now + LIFETIME ||
                typeof draft.expiresAt !== 'number' ||
                draft.expiresAt <= now ||
                draft.expiresAt > now + LIFETIME
            ) {
                throw new Error('Invalid authentication draft');
            }
            return {
                mode: draft.mode,
                email: draft.email,
                username: draft.username,
                resendAt: draft.resendAt,
            };
        } catch {
            await this.clear();
            return null;
        }
    }

    save(draft: AuthFlowDraft): Promise<void> {
        const generation = this.generation;
        const value = JSON.stringify({
            version: 1,
            mode: draft.mode,
            email: draft.email.slice(0, 254),
            username: draft.username.slice(0, 15),
            resendAt: draft.resendAt,
            expiresAt: Date.now() + LIFETIME,
        });
        const work = this.writes
            .catch(() => {})
            .then(async () => {
                if (generation === this.generation) {
                    await this.storage.set(KEY, value);
                }
            });
        this.writes = work;
        return work;
    }

    clear(): Promise<void> {
        this.generation++;
        const work = this.writes.catch(() => {}).then(() => this.storage.remove(KEY));
        this.writes = work;
        return work;
    }
}
