import { preferencesStorage } from '../src/platform/preferencesStorage';
import {
    notificationsEnabled,
    setNotificationsEnabled,
    subscribeNotificationPreferences,
} from '../src/platform/notificationPreferences';

jest.mock('../src/platform/preferencesStorage', () => ({
    preferencesStorage: { getItem: jest.fn(), setItem: jest.fn() },
}));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((accept, decline) => {
        resolve = accept;
        reject = decline;
    });
    return { promise, resolve, reject };
}

beforeEach(() => jest.resetAllMocks());

test('opt-out immediately overrides foreground reads and a read started before its commit', async () => {
    const oldRead = deferred<string | null>();
    const commit = deferred<void>();
    jest.mocked(preferencesStorage.getItem).mockReturnValue(oldRead.promise);
    jest.mocked(preferencesStorage.setItem).mockReturnValue(commit.promise);
    const changes: boolean[] = [];
    const unsubscribe = subscribeNotificationPreferences((change) => {
        if (change.userId === 101 && change.enabled !== undefined) changes.push(change.enabled);
    });
    const reading = notificationsEnabled(101);
    const saving = setNotificationsEnabled(101, false);
    expect(changes).toEqual([false]);
    expect(await notificationsEnabled(101)).toBe(false);
    oldRead.resolve('true');
    expect(await reading).toBe(false);
    commit.resolve();
    await saving;
    expect(await notificationsEnabled(101)).toBe(false);
    unsubscribe();
});

test('failed opt-out stays disabled until a later explicit opt-in commits', async () => {
    jest.mocked(preferencesStorage.getItem).mockResolvedValue('true');
    jest.mocked(preferencesStorage.setItem).mockRejectedValueOnce(new Error('disk unavailable'));
    const failed = setNotificationsEnabled(102, false);
    await expect(failed).rejects.toThrow('disk unavailable');
    expect(await notificationsEnabled(102)).toBe(false);
    const commit = deferred<void>();
    jest.mocked(preferencesStorage.setItem).mockReturnValue(commit.promise);
    const enabling = setNotificationsEnabled(102, true);
    expect(await notificationsEnabled(102)).toBe(false);
    commit.resolve();
    await enabling;
    expect(await notificationsEnabled(102)).toBe(true);
});

test('concurrent on/off/on writes serialize and only the latest intent can publish enable', async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const third = deferred<void>();
    jest.mocked(preferencesStorage.setItem)
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)
        .mockReturnValueOnce(third.promise);
    const changes: boolean[] = [];
    const unsubscribe = subscribeNotificationPreferences((change) => {
        if (change.userId === 103 && change.enabled !== undefined) changes.push(change.enabled);
    });
    const on = setNotificationsEnabled(103, true);
    const off = setNotificationsEnabled(103, false);
    const lastOn = setNotificationsEnabled(103, true);
    await Promise.resolve();
    await Promise.resolve();
    expect(jest.mocked(preferencesStorage.setItem).mock.calls).toEqual([
        ['notifications:103', 'true'],
    ]);
    first.resolve();
    await on;
    expect(await notificationsEnabled(103)).toBe(false);
    expect(changes).toEqual([false]);
    second.resolve();
    await off;
    expect(await notificationsEnabled(103)).toBe(false);
    expect(changes).toEqual([false]);
    third.resolve();
    await lastOn;
    expect(jest.mocked(preferencesStorage.setItem).mock.calls).toEqual([
        ['notifications:103', 'true'],
        ['notifications:103', 'false'],
        ['notifications:103', 'true'],
    ]);
    expect(changes).toEqual([false, true]);
    expect(await notificationsEnabled(103)).toBe(true);
    unsubscribe();
});

test('late successful opt-in cannot undo a newer failed opt-out or affect another account', async () => {
    const oldOn = deferred<void>();
    jest.mocked(preferencesStorage.getItem).mockResolvedValue('true');
    jest.mocked(preferencesStorage.setItem)
        .mockReturnValueOnce(oldOn.promise)
        .mockRejectedValueOnce(new Error('latest opt-out failed'));
    const changes: boolean[] = [];
    const unsubscribe = subscribeNotificationPreferences((change) => {
        if (change.userId === 104 && change.enabled !== undefined) changes.push(change.enabled);
    });
    const enabling = setNotificationsEnabled(104, true);
    const disabling = setNotificationsEnabled(104, false);
    const failed = expect(disabling).rejects.toThrow('latest opt-out failed');
    oldOn.resolve();
    await enabling;
    await failed;
    expect(changes).toEqual([false]);
    expect(await notificationsEnabled(104)).toBe(false);
    expect(await notificationsEnabled(105)).toBe(true);
    unsubscribe();
});
