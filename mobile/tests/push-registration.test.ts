import assert from 'node:assert/strict';
import test from 'node:test';
import {
    PushRegistration,
    type PushContext,
    type PushRegistrationDependencies,
    type PushToken,
} from '../src/services/pushRegistration';

const account: PushContext = {
    userId: 1,
    sessionKey: 'test-session-one',
    enabled: true,
    mutedChats: [],
    activeChatKey: null,
};

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((accept) => {
        resolve = accept;
    });
    return { promise, resolve };
}

function harness(overrides: Partial<PushRegistrationDependencies> = {}) {
    const contexts: Omit<PushContext, 'sessionKey'>[] = [];
    const accounts: (number | null)[] = [];
    const registrations: { userId: number; token: string; mutedChats: string[] }[] = [];
    const deletions: number[] = [];
    const service = new PushRegistration({
        getToken: async () => ({ available: true, token: 'local-fixture-token' }),
        reconcileAccount: async (userId) => void accounts.push(userId),
        setContext: async (context) => void contexts.push(context),
        register: async (userId, body) => {
            registrations.push({ userId, token: body.token, mutedChats: body.mutedChats });
            return { registered: true, deliveryReady: true };
        },
        unregister: async (userId) => void deletions.push(userId),
        ...overrides,
    });
    return { service, accounts, contexts, registrations, deletions };
}

test('push: unconfigured build never registers a fabricated token', async () => {
    const { service, registrations } = harness({
        getToken: async () => ({ available: false, token: null, reason: 'not_configured' }),
    });
    service.update(account);
    await service.refresh();
    assert.equal(service.status, 'unavailable');
    assert.equal(registrations.length, 0);
    service.dispose();
});

test('push: token rotation and muted chats synchronize; visible chat stays native only', async () => {
    let token = 'token-one';
    const { service, contexts, registrations } = harness({
        getToken: async () => ({ available: true, token }),
    });
    service.update({ ...account, mutedChats: ['dm:Nova', 'room:10', 'dm:Nova'] });
    await service.refresh();
    assert.deepEqual(registrations[0].mutedChats, ['dm:Nova', 'room:10']);
    service.update({ ...account, mutedChats: ['room:10', 'dm:Nova'], activeChatKey: 'dm:Nova' });
    await service.refresh();
    assert.equal(registrations.length, 1);
    assert.equal(contexts.at(-1)?.activeChatKey, 'dm:Nova');
    assert.equal('sessionKey' in contexts.at(-1)!, false);
    token = 'token-two';
    await service.refresh();
    assert.equal(registrations.at(-1)?.token, 'token-two');
    assert.equal(service.status, 'ready');
    service.dispose();
});

test('push: disabling and logout immediately suppress native delivery during slow token lookup', async () => {
    const pending = deferred<PushToken>();
    const { service, contexts, registrations, deletions } = harness({
        getToken: () => pending.promise,
    });
    service.update(account);
    service.update({ ...account, enabled: false });
    assert.equal(contexts.at(-1)?.enabled, false);
    assert.equal(service.status, 'disabled');
    pending.resolve({ available: true, token: 'late-token' });
    await service.refresh();
    assert.equal(registrations.length, 0);
    assert.deepEqual(deletions, [1]);
    service.update({ ...account, userId: null, sessionKey: null, enabled: false });
    assert.equal(contexts.at(-1)?.userId, null);
    await service.refresh();
    assert.equal(registrations.length, 0);
    service.dispose();
});

test('push: account change discards stale token lookup before network registration', async () => {
    const pending = deferred<PushToken>();
    let calls = 0;
    const { service, registrations } = harness({
        getToken: () =>
            calls++ === 0
                ? pending.promise
                : Promise.resolve({ available: true, token: 'second-account-token' }),
    });
    service.update(account);
    service.update({ ...account, userId: 2, sessionKey: 'test-session-two' });
    pending.resolve({ available: true, token: 'first-account-token' });
    await service.refresh();
    assert.deepEqual(
        registrations.map(({ userId }) => userId),
        [2],
    );
    assert.equal(registrations[0].token, 'second-account-token');
    service.dispose();
});

test('push: failed registration retries and server readiness remains explicit', async () => {
    let attempt = 0;
    const { service } = harness({
        register: async () => {
            attempt++;
            if (attempt <= 2) throw new Error('fixture offline');
            return { registered: true, deliveryReady: attempt >= 4 };
        },
    });
    service.update(account);
    await service.refresh();
    assert.equal(service.status, 'retrying');
    await service.refresh();
    assert.equal(service.status, 'unavailable');
    await service.refresh();
    assert.equal(service.status, 'ready');
    service.dispose();
});

test('push: disposal suppresses a late response and preserves native delivery after closure', async () => {
    const pending = deferred<{ registered: boolean; deliveryReady: boolean }>();
    const { service, contexts } = harness({ register: () => pending.promise });
    service.update(account);
    await Promise.resolve();
    const completed = service.refresh();
    service.dispose();
    pending.resolve({ registered: true, deliveryReady: true });
    await completed;
    assert.equal(contexts.length, 1);
    assert.equal(contexts.at(-1)?.enabled, true);
    assert.equal(contexts.at(-1)?.userId, account.userId);
    assert.notEqual(service.status, 'ready');
});

test('push: resolved account waits for preferences without disabling saved same-account consent', async () => {
    const { service, accounts, contexts, registrations, deletions } = harness();
    await service.refresh();
    assert.deepEqual(accounts, []);
    service.restoreAccount(account.userId, account.sessionKey);
    await service.refresh();
    assert.deepEqual(accounts, [account.userId]);
    assert.equal(contexts.length, 0);
    assert.deepEqual(registrations, []);
    assert.deepEqual(deletions, []);
    service.update(account);
    await service.refresh();
    assert.equal(contexts.at(-1)?.enabled, true);
    assert.equal(service.status, 'ready');
    service.dispose();
    assert.deepEqual(accounts, [account.userId]);
    assert.equal(contexts.length, 1);
});

test('push: first resolved unauthenticated state clears persisted native account', async () => {
    const { service, accounts, contexts, registrations, deletions } = harness();
    service.restoreAccount(null, null);
    await service.refresh();
    assert.deepEqual(accounts, [null]);
    assert.deepEqual(contexts, []);
    assert.deepEqual(registrations, []);
    assert.deepEqual(deletions, []);
    service.dispose();
});

test('push: same-account token refresh retains consent and mutes', async () => {
    const { service, accounts, contexts, registrations, deletions } = harness();
    service.restoreAccount(account.userId, account.sessionKey);
    service.update({ ...account, mutedChats: ['dm:Nova'] });
    await service.refresh();
    service.restoreAccount(account.userId, 'refreshed-session');
    await service.refresh();
    assert.deepEqual(accounts, [account.userId]);
    assert.equal(
        contexts.every((context) => context.enabled),
        true,
    );
    assert.deepEqual(contexts.at(-1)?.mutedChats, ['dm:Nova']);
    assert.equal(registrations.length, 2);
    assert.deepEqual(deletions, []);
    service.dispose();
});

test('push: account switch suspends delivery until new preferences and ignores old token lookup', async () => {
    const pending = deferred<PushToken>();
    const { service, accounts, contexts, registrations, deletions } = harness({
        getToken: () => pending.promise,
    });
    service.update(account);
    service.restoreAccount(2, 'session-two');
    pending.resolve({ available: true, token: 'stale-token' });
    await service.refresh();
    assert.deepEqual(accounts, [2]);
    assert.deepEqual(registrations, []);
    assert.deepEqual(deletions, []);
    assert.equal(contexts.length, 1);
    service.update({ ...account, userId: 2, sessionKey: 'session-two', enabled: false });
    await service.refresh();
    assert.deepEqual(deletions, [2]);
    service.dispose();
    assert.equal(contexts.at(-1)?.userId, 2);
    assert.equal(contexts.at(-1)?.enabled, false);
});

test('push: explicit logout and consent-off remain cleared after controller disposal', async () => {
    for (const logout of [true, false]) {
        const { service, accounts, contexts } = harness();
        service.update(account);
        await service.refresh();
        if (logout) {
            service.restoreAccount(null, null);
        } else {
            service.update({ ...account, enabled: false });
        }
        service.dispose();
        if (logout) {
            assert.deepEqual(accounts, [null]);
        } else {
            assert.equal(contexts.at(-1)?.enabled, false);
        }
    }
});

test('push: disposal during token lookup never registers a late token or clears native consent', async () => {
    const pending = deferred<PushToken>();
    const { service, accounts, contexts, registrations } = harness({
        getToken: () => pending.promise,
    });
    service.update(account);
    const completed = service.refresh();
    service.dispose();
    pending.resolve({ available: true, token: 'late-token' });
    await completed;
    assert.deepEqual(accounts, []);
    assert.equal(contexts.length, 1);
    assert.equal(contexts.at(-1)?.enabled, true);
    assert.deepEqual(registrations, []);
});
