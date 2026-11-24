import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthFlowStore } from '../src/services/authFlow';
import type { SecureStorage } from '../src/services/storage';
import { confirmationCode, isConfirmationCode } from '../src/services/confirmationCode';

class MemoryStorage implements SecureStorage {
    values = new Map<string, string>();
    async get(key: string) {
        return this.values.get(key) ?? null;
    }
    async set(key: string, value: string) {
        this.values.set(key, value);
    }
    async remove(key: string) {
        this.values.delete(key);
    }
}

test('emailed confirmation codes require six ASCII digits and preserve leading zeroes', () => {
    for (const valid of ['012345', '000000', '999999']) {
        assert.equal(isConfirmationCode(valid), true);
        assert.equal(confirmationCode(valid), valid);
    }
    assert.equal(confirmationCode(' 012345 '), '012345');
    for (const invalid of [
        '',
        '12345',
        '1234567',
        'ABCDEF1234',
        '0123456789',
        '12a345',
        '１２３４５６',
        '12 345',
    ]) {
        assert.equal(isConfirmationCode(invalid), false);
        assert.throws(() => confirmationCode(invalid), /Введите код из 6 цифр/);
    }
});

test('auth flow: cold restoration keeps the absolute deadline and excludes all secrets/consent', async () => {
    const storage = new MemoryStorage();
    const deadline = Date.now() + 45000;
    const draft = {
        mode: 'verify' as const,
        email: 'pending@example.test',
        username: 'Pending',
        resendAt: deadline,
        password: 'Never persist this password',
        repeat: 'Never persist the repetition',
        code: '012345',
        accepted: true,
    };
    await new AuthFlowStore(storage).save(draft);
    const restored = await new AuthFlowStore(storage).load();
    assert.deepEqual(restored, {
        mode: 'verify',
        email: draft.email,
        username: draft.username,
        resendAt: deadline,
    });
    const persisted = [...storage.values.values()].join('');
    for (const secret of [draft.password, draft.repeat, draft.code, 'accepted']) {
        assert.equal(persisted.includes(secret), false);
    }
});

test('auth flow: logout/explicit close wins over an in-flight storage write and pending load', async () => {
    const storage = new MemoryStorage();
    let started!: () => void;
    const writing = new Promise<void>((resolve) => (started = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    storage.set = async (key, value) => {
        started();
        await gate;
        storage.values.set(key, value);
    };
    const flow = new AuthFlowStore(storage);
    const saved = flow.save({
        mode: 'verify',
        email: 'old@example.test',
        username: '',
        resendAt: 0,
    });
    await writing;
    const loading = flow.load();
    const cleared = flow.clear();
    release();
    await Promise.all([saved, cleared]);
    assert.equal(await loading, null);
    assert.equal(await new AuthFlowStore(storage).load(), null);
});

test('auth flow: registration draft survives a cold instance; expired/corrupt steps are discarded', async () => {
    const storage = new MemoryStorage();
    const flow = new AuthFlowStore(storage);
    const draft = {
        mode: 'register' as const,
        email: 'new@example.test',
        username: 'New',
        resendAt: 0,
    };
    await flow.save(draft);
    assert.deepEqual(await new AuthFlowStore(storage).load(), draft);
    storage.values.set(
        'auth.pending',
        JSON.stringify({ ...draft, version: 1, expiresAt: Date.now() - 1 }),
    );
    assert.equal(await flow.load(), null);
    assert.equal(storage.values.has('auth.pending'), false);
    storage.values.set('auth.pending', '{broken');
    assert.equal(await flow.load(), null);
    assert.equal(storage.values.has('auth.pending'), false);
});
