import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { usePushRegistration } from '../src/app/hooks/usePushRegistration';
import { native } from '../src/platform/NativePlayTime';
import {
    mutedNotificationChats,
    notificationsEnabled,
    subscribeNotificationPreferences,
} from '../src/platform/notificationPreferences';
import type { PlayTimeClient } from '../src/services/client';
import { initialSnapshot } from '../src/services/snapshot';
import type { ClientSnapshot, Session } from '../src/types';

jest.mock('../src/platform/NativePlayTime', () => ({
    native: {
        addListener: jest.fn(),
        removeListeners: jest.fn(),
        getPushToken: jest.fn(),
        reconcilePushAccount: jest.fn(),
        setPushContext: jest.fn(),
    },
}));
jest.mock('../src/platform/notificationPreferences', () => ({
    notificationsEnabled: jest.fn(),
    mutedNotificationChats: jest.fn(),
    subscribeNotificationPreferences: jest.fn(),
}));
jest.mock('../src/platform/pushStatus', () => ({
    publishPushStatus: jest.fn(),
    usePushStatus: () => 'disabled',
}));

function Probe({ client }: { client: PlayTimeClient }) {
    usePushRegistration({ client, state: client.snapshot, chatVisible: false });
    return null;
}

function session(id: number, token = `session-${id}`): Session {
    return {
        token,
        refreshToken: `refresh-${id}`,
        expiresIn: 3600,
        user: { id, username: `Account${id}`, email: `account${id}@example.invalid` },
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((accept) => {
        resolve = accept;
    });
    return { promise, resolve };
}

async function mount(snapshot: Partial<ClientSnapshot> = {}) {
    let notify!: () => void;
    const client = {
        snapshot: { ...initialSnapshot(), ...snapshot },
        request: jest.fn(async () => ({ registered: true, deliveryReady: true })),
        subscribe: jest.fn((listener: () => void) => {
            notify = listener;
            return () => undefined;
        }),
    };
    let renderer!: ReactTestRenderer;
    await act(async () => {
        renderer = create(
            React.createElement(Probe, { client: client as unknown as PlayTimeClient }),
        );
    });
    return {
        client,
        async update(patch: Partial<ClientSnapshot>) {
            await act(async () => {
                client.snapshot = { ...client.snapshot, ...patch };
                notify();
                renderer.update(
                    React.createElement(Probe, { client: client as unknown as PlayTimeClient }),
                );
            });
        },
        async unmount() {
            await act(async () => renderer.unmount());
        },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(native.getPushToken).mockResolvedValue({ available: true, token: 'sdk-token' });
    jest.mocked(native.reconcilePushAccount).mockResolvedValue(true);
    jest.mocked(native.setPushContext).mockResolvedValue(true);
    jest.mocked(notificationsEnabled).mockResolvedValue(true);
    jest.mocked(mutedNotificationChats).mockResolvedValue([]);
    jest.mocked(subscribeNotificationPreferences).mockReturnValue(() => undefined);
});

test('unknown bootstrap never mutates native consent; resolved null clears it', async () => {
    const fixture = await mount();
    try {
        expect(native.reconcilePushAccount).not.toHaveBeenCalled();
        expect(native.setPushContext).not.toHaveBeenCalled();
        await fixture.update({ currentChat: { id: 2, name: 'Peer', isRoom: false } });
        expect(native.setPushContext).not.toHaveBeenCalled();
        await fixture.update({ bootstrapping: false });
        expect(native.reconcilePushAccount).toHaveBeenCalledWith(null);
        expect(native.setPushContext).not.toHaveBeenCalled();
    } finally {
        await fixture.unmount();
    }
    expect(native.reconcilePushAccount).toHaveBeenCalledTimes(1);
});

test('cold same-account restoration and closure preserve consent while preferences load', async () => {
    const pending = deferred<boolean>();
    jest.mocked(notificationsEnabled).mockReturnValue(pending.promise);
    const fixture = await mount();
    await fixture.update({ bootstrapping: false, session: session(12) });
    expect(native.reconcilePushAccount).toHaveBeenCalledWith(12);
    expect(native.setPushContext).not.toHaveBeenCalled();
    expect(native.getPushToken).not.toHaveBeenCalled();
    await fixture.unmount();
    await act(async () => pending.resolve(true));
    expect(native.setPushContext).not.toHaveBeenCalled();
    expect(native.reconcilePushAccount).toHaveBeenCalledTimes(1);
    expect(fixture.client.request).not.toHaveBeenCalled();
});

test('A to B to A rejects preference results from both earlier identities', async () => {
    const firstA = deferred<boolean>();
    const accountB = deferred<boolean>();
    const secondA = deferred<boolean>();
    jest.mocked(notificationsEnabled)
        .mockReturnValueOnce(firstA.promise)
        .mockReturnValueOnce(accountB.promise)
        .mockReturnValueOnce(secondA.promise);
    const fixture = await mount({ bootstrapping: false, session: session(12) });
    try {
        await fixture.update({ session: session(13) });
        await fixture.update({ session: session(12, 'new-session-12') });
        await act(async () => {
            firstA.resolve(true);
            accountB.resolve(true);
        });
        expect(native.setPushContext).not.toHaveBeenCalled();
        await act(async () => secondA.resolve(false));
        expect(native.reconcilePushAccount).toHaveBeenNthCalledWith(1, 12);
        expect(native.reconcilePushAccount).toHaveBeenNthCalledWith(2, 13);
        expect(native.reconcilePushAccount).toHaveBeenNthCalledWith(3, 12);
        expect(native.setPushContext).toHaveBeenCalledTimes(1);
        expect(native.setPushContext).toHaveBeenCalledWith(12, false, [], null);
        expect(native.getPushToken).not.toHaveBeenCalled();
    } finally {
        await fixture.unmount();
    }
});

test('explicit disable invalidates an already pending enabled preference result', async () => {
    const pending = deferred<boolean>();
    jest.mocked(notificationsEnabled).mockReturnValue(pending.promise);
    const fixture = await mount({ bootstrapping: false, session: session(12) });
    try {
        const listener = jest.mocked(subscribeNotificationPreferences).mock.calls[0][0];
        await act(async () => listener({ userId: 12, enabled: false }));
        expect(native.setPushContext).toHaveBeenCalledWith(12, false, [], null);
        await act(async () => pending.resolve(true));
        expect(native.setPushContext).toHaveBeenCalledTimes(1);
        expect(native.getPushToken).not.toHaveBeenCalled();
        await fixture.update({ session: null });
        expect(native.reconcilePushAccount).toHaveBeenLastCalledWith(null);
    } finally {
        await fixture.unmount();
    }
});

test('same-session bootstrap completion retries discarded preference reads without transient disable', async () => {
    const pending = deferred<boolean>();
    jest.mocked(notificationsEnabled).mockReturnValueOnce(pending.promise).mockResolvedValue(true);
    const fixture = await mount({ bootstrapping: false, session: session(12) });
    try {
        await fixture.update({ bootstrapping: true });
        await act(async () => pending.resolve(true));
        expect(native.setPushContext).not.toHaveBeenCalled();
        await fixture.update({ bootstrapping: false });
        expect(notificationsEnabled).toHaveBeenCalledTimes(2);
        expect(native.setPushContext).toHaveBeenCalledWith(12, true, [], null);
        expect(native.reconcilePushAccount).toHaveBeenCalledTimes(1);
        expect(fixture.client.request).toHaveBeenCalledWith(
            '/push/device',
            expect.objectContaining({ method: 'PUT', expectedUserId: 12 }),
        );
    } finally {
        await fixture.unmount();
    }
    expect(native.setPushContext).toHaveBeenCalledTimes(1);
});
