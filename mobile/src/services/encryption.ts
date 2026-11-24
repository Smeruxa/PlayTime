import type { FeatureHost } from './featureHost';
import nacl from 'tweetnacl';
import {
    b64,
    publicKey,
    decodeKey,
    validateBackupKeys,
    createTransferPayload,
    openTransferPayload,
} from './crypto';
import { nativeBridge } from './nativeBridge';
import { keyFingerprint } from './keyFingerprint';
const errorText = (error: unknown) =>
    error instanceof Error ? error.message : 'Не удалось выполнить действие';
export class EncryptionService {
    private keyContinuation: Promise<void> | null = null;
    constructor(private host: FeatureHost) {}

    async encryptionFingerprint(): Promise<string | null> {
        const secret = this.host.vault.read('dm');
        if (!secret) {
            return null;
        }
        return keyFingerprint(publicKey(secret));
    }

    async prepareEncryption(): Promise<void> {
        const session = this.host.assertSession();
        const generation = this.host.generation;
        this.host.update({ encryption: { ready: false, needsRecovery: false, error: null } });
        try {
            await this.host.vault.load(session.user.id);
            const own = await this.host.getProfile();
            if (generation !== this.host.generation) {
                return;
            }
            const secret = this.host.vault.read('dm');
            const local = secret ? publicKey(secret) : null;
            if (own.dmPublicKey && own.dmPublicKey !== local) {
                this.host.update({
                    encryption: {
                        ready: true,
                        needsRecovery: true,
                        error: 'Старый ключ недоступен. Откройте действия с ключом: продолжите с новым или восстановите историю.',
                    },
                });
                return;
            }
            const next = secret ?? b64(nacl.box.keyPair().secretKey);
            if (!secret) {
                await this.host.vault.write('dm', next);
            }
            if (generation !== this.host.generation) {
                return;
            }
            await this.host.ack('profile:setDmPublicKey', { publicKey: publicKey(next) });
            if (generation === this.host.generation) {
                this.host.update({
                    encryption: { ready: true, needsRecovery: false, error: null },
                });
            }
        } catch (error) {
            if (generation === this.host.generation) {
                this.host.update({
                    encryption: { ready: true, needsRecovery: false, error: errorText(error) },
                });
            }
        }
    }

    assertEncryption(): string {
        const secret = this.host.vault.read('dm');
        if (
            !secret ||
            !this.host.snapshot.encryption.ready ||
            this.host.snapshot.encryption.needsRecovery ||
            this.host.snapshot.encryption.error
        ) {
            throw new Error(
                this.host.snapshot.encryption.error ??
                    'Ключ переписки ещё не готов. Откройте Безопасность в профиле.',
            );
        }
        return secret;
    }

    async exportKeys(password: string): Promise<string> {
        const session = this.host.assertSession();
        const keys = this.host.vault.snapshot();
        validateBackupKeys(keys);
        const native = await nativeBridge();
        return native.encryptKeyBackup(session.user.id, JSON.stringify(keys), password);
    }

    async replaceKeys(keys: Record<string, string>): Promise<void> {
        validateBackupKeys(keys);
        const previous = this.host.vault.snapshot();
        const generation = this.host.generation;
        await this.host.vault.replace(keys);
        if (generation !== this.host.generation) {
            throw new Error('Аккаунт изменился');
        }
        try {
            await this.host.ack('profile:setDmPublicKey', {
                publicKey: publicKey(keys.dm),
                replaceExisting: true,
            });
        } catch (error) {
            if (generation === this.host.generation) {
                await this.host.vault.replace(previous);
            }
            throw error;
        }
        if (generation !== this.host.generation) {
            return;
        }
        this.host.update({ encryption: { ready: true, needsRecovery: false, error: null } });
        await this.host.refreshHome();
        if (this.host.snapshot.currentChat) {
            await this.host.reloadHistory();
        }
    }

    async importKeys(source: string, password: string): Promise<void> {
        const session = this.host.assertSession();
        const generation = this.host.generation;
        const native = await nativeBridge();
        const keys = JSON.parse(await native.decryptKeyBackup(source, session.user.id, password));
        if (generation !== this.host.generation) {
            throw new Error('Аккаунт изменился');
        }
        await this.replaceKeys(keys);
    }

    continueWithNewEncryptionKey(): Promise<void> {
        if (this.keyContinuation) {
            return this.keyContinuation;
        }
        if (!this.host.snapshot.encryption.needsRecovery) {
            return Promise.resolve();
        }
        this.host.assertConnected();
        const keys = { ...this.host.vault.snapshot(), dm: b64(nacl.box.keyPair().secretKey) };
        const operation = this.replaceKeys(keys).finally(() => {
            if (this.keyContinuation === operation) {
                this.keyContinuation = null;
            }
        });
        this.keyContinuation = operation;
        return operation;
    }

    async resetEncryptionKeys(): Promise<void> {
        await this.replaceKeys({ dm: b64(nacl.box.keyPair().secretKey) });
    }

    async createKeyTransfer(): Promise<{ code: string; expiresAt: number }> {
        const session = this.host.assertSession();
        const bundle = createTransferPayload(session.user.id, this.host.vault.snapshot());
        const result = await this.host.request<{ id: string; expiresAt: number }>(
            '/auth/key-transfer/',
            {
                body: { ciphertext: bundle.ciphertext, nonce: bundle.nonce },
            },
        );
        return { code: `${result.id}.${bundle.secret}`, expiresAt: result.expiresAt };
    }

    async consumeKeyTransfer(code: string): Promise<void> {
        const [id, secret, extra] = code.trim().split('.');
        if (
            extra ||
            !id ||
            !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) ||
            !secret
        ) {
            throw new Error('Вставьте полный код переноса с первого устройства');
        }
        decodeKey(secret);
        const session = this.host.assertSession();
        const generation = this.host.generation;
        const result = await this.host.request<{ nonce: string; ciphertext: string }>(
            `/auth/key-transfer/${id}/consume`,
            { body: {} },
        );
        if (generation !== this.host.generation) {
            throw new Error('Аккаунт изменился');
        }
        await this.replaceKeys(
            openTransferPayload(session.user.id, secret, result.nonce, result.ciphertext),
        );
    }
}
