import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HomeService } from '../src/services/home';
import { RealtimeEvents, type RealtimeHost } from '../src/services/realtime';
import { initialSnapshot } from '../src/services/snapshot';
import { ApiError } from '../src/services/http';
import type { FeatureHost } from '../src/services/featureHost';
import type { ClientSnapshot } from '../src/types';
import type { Socket } from 'socket.io-client';

const peer = {
    id: 10,
    user_id: 1,
    friend_id: 2,
    other_user_id: 2,
    friend_username: 'Nova',
    status: 'accepted',
    direction: 'outgoing',
};
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
function harness() {
    const state = initialSnapshot();
    state.session = {
        token: 'test',
        refreshToken: 'test',
        expiresIn: 900,
        user: { id: 1, username: 'Mika', email: 'test@example.test' },
    };
    const host = {
        snapshot: state,
        generation: 0,
        ack: async (event: string) =>
            event === 'friend:list'
                ? [peer]
                : event === 'profile:friendsAvatars'
                ? {}
                : event === 'message:lastPreviews'
                ? {}
                : [],
        getProfile: async () => ({ username: 'Mika' }),
        request: async () => ({ planSlug: 'free', limits: {} }),
        update: (patch: Partial<ClientSnapshot>) => Object.assign(state, patch),
        assertSession: () => state.session!,
        closeChat: () => {
            state.currentChat = null;
        },
    };
    return { host, state, service: new HomeService(host as unknown as FeatureHost) };
}

test('friends and subscription publish while optional presence is still unavailable', async () => {
    const { host, state, service } = harness();
    const presence = deferred<number[]>();
    const normal = host.ack;
    host.ack = (event) => (event === 'presence:listByUserId' ? presence.promise : normal(event));
    const work = service.refreshHome();
    try {
        await flush();
        assert.equal(state.friends[0]?.friend_id, 2);
        assert.equal(state.subscription?.planSlug, 'free');
    } finally {
        presence.resolve([]);
        await work;
    }
});

test('one optional failure preserves loaded resources and retries a busy friend list', async () => {
    const { host, state, service } = harness();
    let attempts = 0;
    const normal = host.ack;
    host.ack = async (event) => {
        if (event === 'friend:list' && ++attempts === 1)
            throw new Error('Сервер обрабатывает ваши запросы. Повторите попытку.');
        return normal(event);
    };
    host.getProfile = async () => {
        throw new Error('Profile unavailable');
    };
    await assert.rejects(service.refreshHome(), /Profile unavailable/);
    assert.equal(state.friends[0]?.friend_id, 2);
    assert.equal(state.subscription?.planSlug, 'free');
    assert.equal(attempts, 2);
});

test('permanent authentication failures remain visible and are never retried', async () => {
    const { host, service } = harness();
    let attempts = 0;
    const failure = new ApiError('Session revoked', 401);
    host.request = async () => {
        attempts++;
        throw failure;
    };
    await assert.rejects(service.refreshHome(), (error) => error === failure);
    assert.equal(attempts, 1);
});

test('old account responses cannot repopulate home after a generation change', async () => {
    const { host, state, service } = harness();
    const friends = deferred<(typeof peer)[]>();
    const normal = host.ack;
    host.ack = (event) => (event === 'friend:list' ? friends.promise : normal(event));
    const work = service.refreshHome();
    await flush();
    host.generation++;
    friends.resolve([peer]);
    await work;
    assert.deepEqual(state.friends, []);
});

test('reconnect still reloads home when encryption preparation fails', async () => {
    const { host } = harness();
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const socket = {
        connected: true,
        on: (event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler),
    } as unknown as Socket;
    let refreshes = 0;
    const errors: unknown[] = [];
    const realtimeHost = {
        ...host,
        socket,
        prepareEncryption: async () => {
            throw new Error('Key unavailable');
        },
        refreshHome: async () => {
            refreshes++;
        },
        report: (error: unknown) => errors.push(error),
        pendingWaits: new Set(),
        foreground: true,
        chatVisible: true,
    } as unknown as RealtimeHost;
    new RealtimeEvents(realtimeHost).attach(socket);
    handlers.get('connect')!();
    await flush();
    assert.equal(refreshes, 1);
    assert.equal(errors.length, 1);
});

test('malformed friend ACK preserves known identity and active history while plan still loads', async () => {
    const { host, state, service } = harness();
    state.friends = [{ ...peer, status: 'accepted', direction: 'outgoing' }];
    state.currentChat = { id: 2, name: 'Nova', isRoom: false };
    const normal = host.ack;
    host.ack = async (event) =>
        event === 'friend:list' ? ({ err: 'unexpected rejection' } as never) : normal(event);
    await assert.rejects(service.refreshHome(), /Некорректный список друзей/);
    assert.equal(state.friends[0].friend_id, 2);
    assert.equal(state.currentChat?.id, 2);
    assert.equal(state.subscription?.planSlug, 'free');
});

test('a queued refresh recovers even when the preceding snapshot failed', async () => {
    const { host, state, service } = harness();
    const release = deferred<void>();
    let profiles = 0;
    host.getProfile = async () => {
        if (++profiles === 1) {
            await release.promise;
            throw new Error('Old profile failed');
        }
        return { username: 'Mika' };
    };
    const first = service.refreshHome();
    await flush();
    const queued = service.refreshHome();
    release.resolve();
    await Promise.all([first, queued]);
    assert.equal(profiles, 2);
    assert.equal(state.subscription?.planSlug, 'free');
});

test('refresh bursts coalesce and at most two home resource calls run concurrently', async () => {
    const { host, service } = harness();
    let active = 0;
    let peak = 0;
    let lists = 0;
    const tracked = async <T>(work: () => Promise<T>): Promise<T> => {
        active++;
        peak = Math.max(peak, active);
        try {
            await flush();
            return await work();
        } finally {
            active--;
        }
    };
    const normalAck = host.ack;
    const normalProfile = host.getProfile;
    const normalRequest = host.request;
    host.ack = (event) =>
        tracked(() => {
            if (event === 'friend:list') lists++;
            return normalAck(event);
        });
    host.getProfile = () => tracked(normalProfile);
    host.request = () => tracked(normalRequest);
    await Promise.all(Array.from({ length: 20 }, () => service.refreshHome()));
    assert.equal(lists, 2);
    assert.ok(peak <= 2, `peak resource calls: ${peak}`);
});

test('a previous connection cannot report stale failures or reload the reconnected chat', async () => {
    const { host, state } = harness();
    state.currentChat = { id: 2, name: 'Nova', isRoom: false };
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const transport = {
        connected: true,
        on: (event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler),
    };
    const release = deferred<void>();
    let preparations = 0;
    let histories = 0;
    const errors: unknown[] = [];
    const realtimeHost = {
        ...host,
        socket: transport,
        prepareEncryption: async () => {
            if (++preparations === 1) {
                await release.promise;
                throw new Error('Old connection key error');
            }
        },
        refreshHome: async () => {},
        reloadHistory: async () => {
            histories++;
        },
        report: (error: unknown) => errors.push(error),
        pendingWaits: new Set(),
        foreground: true,
        chatVisible: true,
    } as unknown as RealtimeHost;
    new RealtimeEvents(realtimeHost).attach(transport as unknown as Socket);
    handlers.get('connect')!();
    await flush();
    transport.connected = false;
    handlers.get('disconnect')!();
    transport.connected = true;
    handlers.get('connect')!();
    await flush();
    assert.equal(histories, 1);
    release.resolve();
    await flush();
    assert.equal(histories, 1);
    assert.deepEqual(errors, []);
});

test('busy failures stop after three attempts and preserve the last friend snapshot', async () => {
    const { host, state, service } = harness();
    state.friends = [{ ...peer, status: 'accepted', direction: 'outgoing' }];
    const normal = host.ack;
    let attempts = 0;
    host.ack = async (event) => {
        if (event === 'friend:list') {
            attempts++;
            throw new Error('Сервер обрабатывает ваши запросы. Повторите попытку.');
        }
        return normal(event);
    };
    await assert.rejects(service.refreshHome(), /обрабатывает ваши запросы/);
    assert.equal(attempts, 3);
    assert.equal(state.friends[0].friend_id, 2);
    assert.equal(state.subscription?.planSlug, 'free');
});
