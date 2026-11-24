import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import nacl from 'tweetnacl';
import { PlayTimeClient, ApiError } from '../src/services/client';
import type { SecureStorage } from '../src/services/storage';
import { KeyVault } from '../src/services/storage';
import { environmentKey } from '../src/services/storageScope';
import {
    b64,
    encryptDm,
    decryptDm,
    encryptRoom,
    decryptRoom,
    roomEpoch,
    roomKeyName,
    encryptMediaBytes,
    decryptMediaBytes,
    parseMedia,
    validateBackupKeys,
    createTransferPayload,
    openTransferPayload,
    MEDIA_PREFIX,
    publicKey,
} from '../src/services/crypto';
import { messageFromWire } from '../src/services/messages';
import { replyPreview } from '../src/services/replyPreview';
import { resolveNotificationChat, resolveMessageChat } from '../src/platform/notificationTarget';
import { PLAN_SLUGS, getPlanLimits } from '../../apps/shared/subscription/planCatalog';
import { decryptDmCiphertext } from '../../apps/frontend/src/features/chat/dmE2ee';
import { decryptRoomCiphertext } from '../../apps/frontend/src/features/chat/roomE2ee';
import { isValidDmE2eeEnvelope } from '../../apps/chat-api/utils/dmE2eeEnvelope';
import { isValidRoomE2eeEnvelope } from '../../apps/chat-api/utils/roomE2eeEnvelope';

const require = createRequire(import.meta.url);
const { createFixtureServer, CODE, PASSWORD } = require('../e2e/fixture-server.cjs') as {
    createFixtureServer(options: { port: number }): {
        start(): Promise<string>;
        stop(): Promise<void>;
        state: {
            pushDevices: Map<string, { userId: number; token: string; mutedChats: string[] }>;
            roomListDelayMs: number;
            roomReads: Map<string, number>;
            messages: { id: number; content: string }[];
            captured: { event: string; payload: Record<string, unknown> }[];
        };
    };
    CODE: string;
    PASSWORD: string;
};
const fixture = createFixtureServer({ port: 0 });
let origin = '';
before(async () => {
    origin = await fixture.start();
});
after(async () => {
    await fixture.stop();
});

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

async function until(predicate: () => boolean, timeout = 6000): Promise<void> {
    const end = Date.now() + timeout;
    while (!predicate()) {
        if (Date.now() > end) {
            throw new Error('Condition timed out');
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}
async function reset() {
    await fetch(`${origin}/__test/reset`, { method: 'POST' });
}
function client(storage: SecureStorage = new MemoryStorage()) {
    return new PlayTimeClient({
        baseUrl: `${origin}/playtime`,
        socketUrl: origin,
        storage,
        timeoutMs: 1000,
    });
}
async function login(instance: PlayTimeClient) {
    await instance.login('mika@example.test', PASSWORD);
    await until(
        () =>
            instance.snapshot.connection === 'online' &&
            instance.snapshot.encryption.ready &&
            instance.snapshot.profile != null,
    );
    assert.equal(instance.snapshot.encryption.error, null);
}

test('fixture plan capabilities match the current production subscription contract', () => {
    const plans = require('../e2e/fixture-plans.json') as Record<string, unknown>;
    for (const slug of PLAN_SLUGS) {
        assert.deepEqual(plans[slug], getPlanLimits(slug));
    }
});

test('mobile ciphertext is accepted by backend and decrypts in desktop (DM and room)', () => {
    const a = nacl.box.keyPair();
    const b = nacl.box.keyPair();
    const message = 'Привет 👋\nСохраняем Unicode и переносы';
    const dm = encryptDm(message, b64(b.publicKey), b64(a.secretKey));
    assert.ok(isValidDmE2eeEnvelope(dm));
    assert.equal(
        decryptDmCiphertext(dm, b.secretKey, b64(a.publicKey), b64(b.publicKey), false),
        message,
    );
    assert.equal(decryptDm(dm, b64(a.publicKey), b64(b.secretKey)), message);
    assert.throws(() => decryptDm(dm, b64(nacl.box.keyPair().publicKey), b64(b.secretKey)));
    const key = nacl.randomBytes(32);
    const room = encryptRoom(message, b64(key));
    assert.ok(isValidRoomE2eeEnvelope(room));
    assert.equal(decryptRoomCiphertext(room, key), message);
    assert.equal(decryptRoom(room, b64(key)), message);
    assert.throws(() => decryptRoom('R2E1:{"n":"bad","b":"bad"}', b64(key)));
});

test('authenticated media rejects tampering, wrong size and descriptor injection', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const encrypted = encryptMediaBytes(bytes);
    const descriptor = {
        kind: 'attachment' as const,
        storageKey: '1c32fe55-45c5-437b-b901-a1c3b7ca51fe',
        key: encrypted.key,
        nonce: encrypted.nonce,
        mime: 'text/html',
        filename: '../bad.html',
        sizeBytes: bytes.length,
    };
    const sanitized = parseMedia(MEDIA_PREFIX + JSON.stringify(descriptor));
    assert.equal(sanitized?.mime, 'application/octet-stream');
    assert.equal(sanitized?.filename, '.._bad.html');
    assert.deepEqual(decryptMediaBytes(encrypted.bytes, descriptor), bytes);
    encrypted.bytes[0] = (encrypted.bytes[0] + 1) % 256;
    assert.throws(() => decryptMediaBytes(encrypted.bytes, descriptor));
    assert.equal(
        parseMedia(MEDIA_PREFIX + JSON.stringify({ ...descriptor, key: 'invalid' })),
        null,
    );
    assert.throws(() =>
        validateBackupKeys({ dm: descriptor.key, '__proto__:key': descriptor.key }),
    );
});

test('key transfer is account-bound and interoperable with desktop secretbox envelope', () => {
    const keys = { dm: b64(nacl.box.keyPair().secretKey), 'room:10': b64(nacl.randomBytes(32)) };
    const transfer = createTransferPayload(1, keys);
    assert.deepEqual(
        openTransferPayload(1, transfer.secret, transfer.nonce, transfer.ciphertext),
        keys,
    );
    assert.throws(
        () => openTransferPayload(2, transfer.secret, transfer.nonce, transfer.ciphertext),
        /другому аккаунту/,
    );
    assert.throws(() =>
        openTransferPayload(1, b64(nacl.randomBytes(32)), transfer.nonce, transfer.ciphertext),
    );
});

test('malformed encrypted history is never rendered as ciphertext or attachment keys', () => {
    const message = messageFromWire(
        { id: 1, content: 'E2E1:{"broken":true}', sender_username: 'Nova' },
        { id: 2, name: 'Nova', isRoom: false },
        'Mika',
    );
    assert.equal(message.decryptError, true);
    assert.equal(message.text.includes('E2E1:'), false);
    const wrongMedia = messageFromWire(
        { id: 2, content: MEDIA_PREFIX + '{}', sender_username: 'Nova' },
        { id: 2, name: 'Nova', isRoom: false },
        'Mika',
    );
    assert.equal(wrongMedia.decryptError, true);
});

test('protocol: login, E2EE chat/reply/edit/reaction/pin/delete, wallpaper, read receipts and logout', async () => {
    await reset();
    const storage = new MemoryStorage();
    const instance = client(storage);
    try {
        await login(instance);
        assert.deepEqual(
            instance.snapshot.friends.map((friend) => friend.friend_username),
            ['Nova', 'Orbit'],
        );
        await instance.openChat({ id: 2, name: 'Nova', isRoom: false });
        assert.equal(instance.snapshot.messages.length, 3);
        assert.match(instance.snapshot.messages[0].text, /Привет/);
        await instance.sendMessage('Android секрет', {
            replyToId: instance.snapshot.messages[0].id,
        });
        const sent = instance.snapshot.messages.at(-1)!;
        assert.equal(sent.text, 'Android секрет');
        assert.ok(sent.reply);
        const serverMessage = fixture.state.messages.find((message) => message.id === sent.id)!;
        assert.ok(serverMessage.content.startsWith('E2E1:'));
        assert.equal(serverMessage.content.includes('Android секрет'), false);
        assert.equal(
            [...storage.values.values()].some((value) => value.includes('Android секрет')),
            false,
        );
        await instance.editMessage(sent.id, 'Исправленный секрет');
        assert.equal(instance.snapshot.messages.at(-1)?.text, 'Исправленный секрет');
        await instance.react(sent.id, '❤️');
        assert.deepEqual(instance.snapshot.messages.at(-1)?.reactions, [
            { emoji: '❤️', users: ['Mika'] },
        ]);
        await instance.pin(sent.id);
        assert.equal(instance.snapshot.pinnedMessageId, sent.id);
        await instance.setWallpaper({ kind: 'preset', id: 'ocean' });
        assert.deepEqual(instance.snapshot.wallpaper, { kind: 'preset', id: 'ocean' });
        await instance.deleteMessage(sent.id);
        assert.equal(
            instance.snapshot.messages.some((message) => message.id === sent.id),
            false,
        );
        await instance.logout();
        assert.equal(instance.snapshot.session, null);
        assert.equal(storage.values.has('session'), false);
        assert.equal(storage.values.has('keys.1'), true);
    } finally {
        instance.dispose();
    }
});

test('protocol: room E2EE, owner/moderator operations and friend actions use server state', async () => {
    await reset();
    const instance = client();
    try {
        await login(instance);
        await instance.openChat({ id: 10, name: 'Вечерний пати', isRoom: true, createdBy: 1 });
        assert.match(instance.snapshot.messages[0].text, /Добро пожаловать/);
        await instance.sendMessage('Комнатный секрет');
        assert.equal(instance.snapshot.messages.at(-1)?.text, 'Комнатный секрет');
        assert.ok(fixture.state.messages.at(-1)?.content.startsWith('R2E1:'));
        assert.deepEqual(await instance.readers(instance.snapshot.messages.at(-1)!.id), ['Mika']);
        const room = await instance.createRoom('Android room');
        await instance.addRoomMembers(room.id, ['Nova']);
        await instance.setRoomRole(room.id, 2, 'moderator');
        assert.equal(
            (await instance.roomMembers(room.id)).members.find((member) => member.id === 2)?.role,
            'moderator',
        );
        await instance.updateRoom(room.id, { name: 'Новая комната' });
        assert.equal((await instance.roomMembers(room.id)).name, 'Новая комната');
        await instance.removeRoomMember(room.id, 2);
        await instance.deleteRoom(room.id);
        assert.equal(
            instance.snapshot.rooms.some((item) => item.id === room.id),
            false,
        );
        await instance.friendAction('accept', 'Luna');
        assert.ok(instance.snapshot.friends.some((friend) => friend.friend_username === 'Luna'));
        await instance.friendAction('decline', 'Echo');
        assert.equal(instance.snapshot.outgoing.includes('Echo'), false);
        await instance.friendAction('request', 'Echo');
        assert.ok(instance.snapshot.outgoing.includes('Echo'));
        await instance.friendAction('remove', 'Luna');
        assert.equal(
            instance.snapshot.friends.some((friend) => friend.friend_username === 'Luna'),
            false,
        );
    } finally {
        instance.dispose();
    }
});

test('protocol: changed peer identity blocks sending until explicit trust', async () => {
    await reset();
    const instance = client();
    try {
        await login(instance);
        await instance.openChat({ id: 2, name: 'Nova', isRoom: false });
        await instance.sendMessage('Trust initial identity');
        await instance.openChat({ id: 10, name: 'Вечерний пати', isRoom: true });
        await instance.openChat({ id: 2, name: 'Nova', isRoom: false });
        await fetch(`${origin}/__test/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'rotatePeerKey', username: 'Nova' }),
        });
        await assert.rejects(instance.sendMessage('Do not send yet'), /Ключ собеседника изменился/);
        assert.equal(instance.snapshot.encryption.changedPeer?.username, 'Nova');
        const displayedKey = instance.snapshot.encryption.changedPeer!.key;
        await fetch(`${origin}/__test/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'incomingMessage',
                text: 'Changed unconfirmed identity',
            }),
        });
        const unconfirmedId = fixture.state.messages.at(-1)!.id;
        await until(() =>
            instance.snapshot.messages.some((message) => message.id === unconfirmedId),
        );
        assert.equal(
            instance.snapshot.messages.find((message) => message.id === unconfirmedId)
                ?.decryptError,
            true,
        );
        assert.notEqual(instance.snapshot.previews['dm:2'].text, 'Changed unconfirmed identity');
        await instance.openChat({ id: 3, name: 'Orbit', isRoom: false });
        await instance.sendMessage('Another peer remains available');
        assert.equal(instance.snapshot.messages.at(-1)?.text, 'Another peer remains available');
        assert.equal(instance.snapshot.encryption.changedPeer?.username, 'Nova');
        await instance.openChat({ id: 10, name: 'Вечерний пати', isRoom: true });
        await instance.sendMessage('Rooms remain available during another peer change');
        assert.ok(fixture.state.messages.at(-1)!.content.startsWith('R2E1:'));
        await instance.openChat({ id: 2, name: 'Nova', isRoom: false });
        await assert.rejects(
            instance.sendMessage('Nova still requires explicit trust'),
            /Ключ собеседника изменился/,
        );
        await fetch(`${origin}/__test/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'rotatePeerKey', username: 'Nova' }),
        });
        await assert.rejects(instance.sendMessage('A second change must stay blocked'));
        await assert.rejects(instance.trustChangedPeer(displayedKey), /снова изменился/);
        await instance.trustChangedPeer(instance.snapshot.encryption.changedPeer!.key);
        await instance.sendMessage('New trusted identity');
        assert.equal(instance.snapshot.messages.at(-1)?.text, 'New trusted identity');
    } finally {
        instance.dispose();
    }
});

test('protocol: second device requires key recovery and one-time transfer restores identity', async () => {
    await reset();
    const first = client();
    const second = client();
    try {
        await login(first);
        const firstKey = first.snapshot.profile?.dmPublicKey;
        await second.login('mika@example.test', PASSWORD);
        await until(() => second.snapshot.encryption.ready && second.snapshot.profile != null);
        assert.equal(second.snapshot.encryption.needsRecovery, true);
        await second.openChat({ id: 2, name: 'Nova', isRoom: false });
        assert.equal(second.snapshot.messages[0].decryptError, true);
        await assert.rejects(second.sendMessage('Must never send with an unrelated key'));
        const transfer = await first.createKeyTransfer();
        await second.consumeKeyTransfer(transfer.code);
        assert.equal(second.snapshot.encryption.needsRecovery, false);
        assert.equal(second.snapshot.profile?.dmPublicKey, firstKey);
        assert.match(second.snapshot.messages[0].text, /Привет/);
        await assert.rejects(second.consumeKeyTransfer(transfer.code), /уже использован/);
    } finally {
        first.dispose();
        second.dispose();
    }
});

test('explicit new-key continuation preserves locked DM history and sends authenticated new messages', async () => {
    await reset();
    const first = client();
    const storage = new MemoryStorage();
    const second = client(storage);
    try {
        await login(first);
        const originalPublic = first.snapshot.profile!.dmPublicKey;
        const originals = fixture.state.messages.map((message) => ({ ...message }));
        await second.login('mika@example.test', PASSWORD);
        await until(() => second.snapshot.encryption.ready);
        await second.openChat({ id: 2, name: 'Nova', isRoom: false });
        assert.equal(second.snapshot.encryption.needsRecovery, true);
        assert.equal(second.snapshot.messages[0].decryptError, true);
        await fetch(`${origin}/__test/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'socketFailure', event: 'profile:setDmPublicKey' }),
        });
        await assert.rejects(second.continueWithNewEncryptionKey(), /временно недоступно/);
        assert.equal(second.snapshot.encryption.needsRecovery, true);
        assert.equal((await first.getProfile()).dmPublicKey, originalPublic);
        assert.equal(JSON.parse(storage.values.get('keys.1')!).dm, undefined);
        await fetch(`${origin}/__test/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'clearFailures' }),
        });
        const publishesBefore = fixture.state.captured.filter(
            (item) => item.event === 'profile:setDmPublicKey',
        ).length;
        await Promise.all([
            second.continueWithNewEncryptionKey(),
            second.continueWithNewEncryptionKey(),
            fetch(`${origin}/__test/events`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'incomingMessage',
                    text: 'Arrived during key publication',
                }),
            }),
        ]);
        assert.equal(second.snapshot.encryption.needsRecovery, false);
        assert.notEqual((await second.getProfile()).dmPublicKey, originalPublic);
        assert.equal(
            fixture.state.captured.filter((item) => item.event === 'profile:setDmPublicKey').length,
            publishesBefore + 1,
        );
        const arrived = fixture.state.messages.at(-1)!;
        await until(() => second.snapshot.messages.some((message) => message.id === arrived.id));
        await second.sendMessage('New encrypted message after lost identity');
        const sent = fixture.state.messages.at(-1)!;
        assert.ok(sent.content.startsWith('E2E1:'));
        assert.equal(sent.content.includes('New encrypted message'), false);
        assert.equal(
            second.snapshot.messages.at(-1)!.text,
            'New encrypted message after lost identity',
        );
        for (const message of originals) {
            assert.equal(
                fixture.state.messages.find((item) => item.id === message.id)!.content,
                message.content,
            );
        }
        assert.equal(second.snapshot.messages[0].decryptError, true);
        await fetch(`${origin}/__test/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'incomingMessage',
                text: 'Fresh peer reply survives key continuation',
            }),
        });
        await until(() =>
            second.snapshot.messages.some(
                (message) => message.text === 'Fresh peer reply survives key continuation',
            ),
        );
        const count = fixture.state.messages.length;
        await fetch(`${origin}/__test/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'rotatePeerKey', username: 'Nova' }),
        });
        await assert.rejects(
            second.sendMessage('Still requires peer verification'),
            /Ключ собеседника изменился/,
        );
        assert.equal(fixture.state.messages.length, count);
    } finally {
        first.dispose();
        second.dispose();
    }
});

test('new-key continuation preserves available room keys and encrypted room sending', async () => {
    await reset();
    const firstStorage = new MemoryStorage();
    const first = client(firstStorage);
    const secondStorage = new MemoryStorage();
    const second = client(secondStorage);
    const room = { id: 10, name: 'Вечерний пати', isRoom: true, createdBy: 1 };
    try {
        await login(first);
        await first.openChat(room);
        const roomKey = JSON.parse(firstStorage.values.get('keys.1')!)['room:10'];
        secondStorage.values.set('keys.1', JSON.stringify({ 'room:10': roomKey }));
        await second.login('mika@example.test', PASSWORD);
        await until(() => second.snapshot.encryption.ready);
        assert.equal(second.snapshot.encryption.needsRecovery, true);
        await second.continueWithNewEncryptionKey();
        assert.equal(JSON.parse(secondStorage.values.get('keys.1')!)['room:10'], roomKey);
        await second.openChat(room);
        await second.sendMessage('Room remains available with its retained key');
        assert.equal(
            second.snapshot.messages.at(-1)!.text,
            'Room remains available with its retained key',
        );
        assert.ok(fixture.state.messages.at(-1)!.content.startsWith('R2E1:'));
        assert.equal(
            decryptRoom(fixture.state.messages.at(-1)!.content, roomKey),
            'Room remains available with its retained key',
        );
    } finally {
        first.dispose();
        second.dispose();
    }
});

test('room recovery never replaces an old wrap and an existing member provisions the reinvited identity', async () => {
    await reset();
    const first = client();
    const second = client();
    const novaStorage = new MemoryStorage();
    novaStorage.values.set('keys.2', JSON.stringify({ dm: b64(new Uint8Array(32).fill(2)) }));
    const nova = client(novaStorage);
    const room = { id: 10, name: 'Вечерний пати', isRoom: true, createdBy: 2 };
    try {
        await login(first);
        await first.openChat(room);
        await first.transferRoomOwnership(10, 2);
        await nova.login('nova@example.test', PASSWORD);
        await until(
            () => nova.snapshot.encryption.ready && !nova.snapshot.encryption.needsRecovery,
        );
        await nova.openChat({ id: 1, name: 'Mika', isRoom: false });
        await nova.sendMessage('Pin Mika before key continuation');
        await nova.openChat(room);
        const roomKey = JSON.parse(novaStorage.values.get('keys.2')!)['room:10'];
        await second.login('mika@example.test', PASSWORD);
        await until(() => second.snapshot.encryption.ready);
        const original = await second.ack('room:e2eeBundle', { roomId: 10 });
        await second.continueWithNewEncryptionKey();
        await second.openChat(room);
        const count = fixture.state.messages.length;
        await assert.rejects(
            second.sendMessage('Cannot invent a different shared room key'),
            /пригласить заново/,
        );
        assert.equal(fixture.state.messages.length, count);
        assert.deepEqual(await second.ack('room:e2eeBundle', { roomId: 10 }), {
            ...original,
            members: (await second.ack<{ members: unknown[] }>('room:e2eeBundle', { roomId: 10 }))
                .members,
        });
        const wrapsBefore = fixture.state.captured.filter(
            (item) => item.event === 'room:e2eePutWraps',
        ).length;
        await nova.removeRoomMember(10, 1);
        await nova.addRoomMembers(10, ['Mika']);
        await until(() => nova.snapshot.encryption.changedPeer?.peerUserId === 1);
        await nova.trustChangedPeer(nova.snapshot.encryption.changedPeer!.key);
        await nova.openChat(room);
        await until(
            () =>
                fixture.state.captured.filter((item) => item.event === 'room:e2eePutWraps').length >
                wrapsBefore,
        );
        await second.openChat(room);
        await second.sendMessage('Reinvited identity sends with a fresh shared key');
        const sent = fixture.state.messages.at(-1)!;
        assert.ok(sent.content.startsWith('R2E1:'));
        const epoch = roomEpoch(sent.content);
        assert.ok(epoch > 0);
        const latestKey = JSON.parse(novaStorage.values.get('keys.2')!)[roomKeyName(10, epoch)];
        assert.equal(
            decryptRoom(sent.content, latestKey),
            'Reinvited identity sends with a fresh shared key',
        );
        assert.throws(() => decryptRoom(sent.content, roomKey));
        const archive = await second.ack<{ myWrap: unknown }>('room:e2eeBundle', {
            roomId: 10,
            epoch: 0,
            keyProtocol: 1,
        });
        assert.equal(archive.myWrap, null);
        assert.equal(
            second.snapshot.messages.at(-1)!.text,
            'Reinvited identity sends with a fresh shared key',
        );
    } finally {
        first.dispose();
        second.dispose();
        nova.dispose();
    }
});

test('protocol: verification, profile, code-scoped sessions and safety API', async () => {
    await reset();
    const instance = client();
    try {
        assert.equal(
            (await instance.register('Tester', 'tester@example.test', PASSWORD))
                .verificationRequired,
            true,
        );
        await assert.rejects(
            instance.login('tester@example.test', PASSWORD),
            (error: unknown) => error instanceof ApiError && error.verificationRequired,
        );
        for (const code of ['12345', '1234567', 'ABCDEF1234', '0123456789', '12a345']) {
            await assert.rejects(instance.verifyEmail('tester@example.test', code), /6 цифр/);
            await assert.rejects(
                instance.resetPassword('tester@example.test', code, PASSWORD),
                /6 цифр/,
            );
            await assert.rejects(
                instance.revokeSession('test-session', 'test-challenge', code),
                /6 цифр/,
            );
        }
        await assert.rejects(instance.verifyEmail('tester@example.test', '000000'));
        await instance.verifyEmail('tester@example.test', CODE);
        await login(instance);
        await instance.updateProfile({ status: 'На Android', bio: 'Сохранено с телефона' });
        assert.equal(instance.snapshot.profile?.status, 'На Android');
        const sessions = await instance.sessions();
        assert.equal(sessions.length, 2);
        const other = sessions.find((session) => !session.current)!;
        const challenge = await instance.requestSessionRevocation(other.id);
        await assert.rejects(instance.revokeSession(other.id, challenge.challengeId, '000000'));
        await instance.revokeSession(other.id, challenge.challengeId, CODE);
        assert.equal((await instance.sessions()).length, 1);
        await instance.safety('Orbit', 'report', 'Нежелательные сообщения в тесте');
        await instance.safety('Orbit', 'block');
        assert.deepEqual(await instance.blockedUsers(), ['Orbit']);
        assert.equal(
            instance.snapshot.friends.some((friend) => friend.friend_username === 'Orbit'),
            false,
        );
        await instance.safety('Orbit', 'unblock');
        assert.deepEqual(await instance.blockedUsers(), []);
    } finally {
        instance.dispose();
    }
});

test('protocol: password recovery preserves all six digits including the leading zero', async () => {
    await reset();
    const instance = client();
    try {
        assert.equal(CODE, '012345');
        await assert.rejects(instance.resetPassword('mika@example.test', '000000', PASSWORD));
        await instance.resetPassword('mika@example.test', CODE, PASSWORD);
        await login(instance);
        assert.equal(instance.snapshot.session?.user.username, 'Mika');
    } finally {
        instance.dispose();
    }
});

test('call endpoint identity is memory-only, stable across socket reconnects and fresh for a new client', async () => {
    await reset();
    const storage = new MemoryStorage();
    const first = client(storage);
    const second = client(storage);
    try {
        assert.match(
            first.callEndpointId,
            /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
        );
        assert.notEqual(first.callEndpointId, second.callEndpointId);
        await login(first);
        const auth = first.socket!.auth;
        assert.equal(typeof auth, 'function');
        let handshake: Record<string, unknown> = {};
        if (typeof auth === 'function')
            auth((value) => {
                handshake = value as Record<string, unknown>;
            });
        assert.equal(handshake.callProtocol, 3);
        assert.equal(handshake.callEndpointId, first.callEndpointId);
        const endpoint = first.callEndpointId;
        first.socket!.disconnect();
        first.socket!.connect();
        await until(() => first.snapshot.connection === 'online');
        assert.equal(first.callEndpointId, endpoint);
        assert.equal(
            [...storage.values.values()].some((value) => value.includes(endpoint)),
            false,
        );
    } finally {
        first.dispose();
        second.dispose();
    }
});

test('offline bootstrap retains credentials and reconnects without re-login', async () => {
    await reset();
    const storage = new MemoryStorage();
    const first = client(storage);
    await login(first);
    first.dispose();
    const offline = new PlayTimeClient({
        baseUrl: `${origin}/playtime`,
        socketUrl: origin,
        storage,
        fetch: async () => {
            throw new Error('offline');
        },
    });
    await offline.bootstrap();
    assert.ok(offline.snapshot.session);
    assert.ok(storage.values.has('session'));
    assert.match(offline.snapshot.error ?? '', /Проверьте интернет/);
    offline.dispose();
    const restored = client(storage);
    try {
        await restored.bootstrap();
        await until(() => restored.snapshot.profile != null);
        assert.equal(restored.snapshot.session?.user.username, 'Mika');
        assert.equal(restored.snapshot.encryption.needsRecovery, false);
    } finally {
        restored.dispose();
    }
});

test('key vault serialization prevents writes and late loads crossing accounts', async () => {
    const storage = new MemoryStorage();
    const vault = new KeyVault(storage);
    const a = b64(nacl.box.keyPair().secretKey);
    const b = b64(nacl.box.keyPair().secretKey);
    await vault.load(1);
    await Promise.all([vault.write('dm', a), vault.load(1), vault.write('room:10', b)]);
    assert.deepEqual(vault.snapshot(), { dm: a, 'room:10': b });
    await vault.load(2);
    assert.deepEqual(vault.snapshot(), {});
    await vault.write('dm', b);
    assert.equal(publicKey(vault.read('dm')!), publicKey(b));
    await vault.load(1);
    assert.equal(vault.read('dm'), a);
    vault.clear();
    await assert.rejects(vault.write('dm', b));
});

test('hidden conversation preserves unread messages until the chat becomes visible', async () => {
    await reset();
    const instance = client();
    try {
        await login(instance);
        await instance.openChat({ id: 2, name: 'Nova', isRoom: false });
        instance.setChatVisible(false);
        const readReceiptsBefore = fixture.state.captured.filter(
            (item) => item.event === 'message:markRead',
        ).length;
        await fetch(`${origin}/__test/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'incomingMessage',
                text: 'Сообщение за скрытым экраном',
            }),
        });
        await until(
            () => instance.snapshot.messages.at(-1)?.text === 'Сообщение за скрытым экраном',
        );
        assert.equal(instance.snapshot.previews['dm:2'].unread, 1);
        assert.equal(
            fixture.state.captured.filter((item) => item.event === 'message:markRead').length,
            readReceiptsBefore,
        );
        instance.setChatVisible(true);
        await until(
            () =>
                fixture.state.captured.filter((item) => item.event === 'message:markRead').length >
                readReceiptsBefore,
        );
        assert.equal(instance.snapshot.previews['dm:2'].unread, 0);
    } finally {
        instance.dispose();
    }
});

test('late refresh after logout cannot restore a removed session', async () => {
    await reset();
    const storage = new MemoryStorage();
    const first = client(storage);
    await login(first);
    const oldToken = first.snapshot.session!.token;
    first.dispose();
    let refreshRequested = false;
    let releaseRefresh: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
        releaseRefresh = resolve;
    });
    const delayed = new PlayTimeClient({
        baseUrl: `${origin}/playtime`,
        socketUrl: origin,
        storage,
        fetch: async (input, init) => {
            if (String(input).endsWith('/auth/tokenValid')) {
                return new Response(JSON.stringify({ valid: false }), { status: 401 });
            }
            if (String(input).endsWith('/auth/refresh')) {
                refreshRequested = true;
                await gate;
            }
            return fetch(input, init);
        },
    });
    try {
        const boot = delayed.bootstrap();
        await until(() => refreshRequested);
        await delayed.logout();
        releaseRefresh?.();
        await boot;
        assert.equal(delayed.snapshot.session, null);
        assert.equal(storage.values.has('session'), false);
        assert.equal(delayed.socket, null);
        assert.ok(oldToken);
    } finally {
        releaseRefresh?.();
        delayed.dispose();
    }
});

test('remote room changes refresh the active title and revoke access when removed', async () => {
    await reset();
    const firstStorage = new MemoryStorage();
    const secondStorage = new MemoryStorage();
    const first = client(firstStorage);
    const second = client(secondStorage);
    try {
        await login(first);
        await first.openChat({ id: 10, name: 'Вечерний пати', isRoom: true });
        secondStorage.values.set('keys.1', firstStorage.values.get('keys.1')!);
        await login(second);
        await second.updateRoom(10, { name: 'Новое имя' });
        await until(() => first.snapshot.currentChat?.name === 'Новое имя');
        assert.equal(first.snapshot.currentChat?.createdBy, 1);
        await second.deleteRoom(10);
        await until(() => first.snapshot.currentChat === null);
        assert.deepEqual(first.snapshot.messages, []);
    } finally {
        first.dispose();
        second.dispose();
    }
});

test('a refresh requested during an older snapshot waits for the newer server state', async () => {
    await reset();
    const storage = new MemoryStorage();
    const instance = client(storage);
    const otherStorage = new MemoryStorage();
    const other = client(otherStorage);
    try {
        await login(instance);
        otherStorage.values.set('keys.1', storage.values.get('keys.1')!);
        await login(other);
        await instance.refreshHome();
        await other.refreshHome();
        fixture.state.roomListDelayMs = 100;
        const requestsBefore = fixture.state.captured.filter(
            (item) => item.event === 'room:list',
        ).length;
        const pending = instance.refreshHome();
        await until(
            () =>
                fixture.state.captured.filter((item) => item.event === 'room:list').length >
                requestsBefore,
        );
        await other.deleteRoom(10);
        await pending;
        assert.equal(
            instance.snapshot.rooms.some((room) => room.id === 10),
            false,
        );
    } finally {
        fixture.state.roomListDelayMs = 0;
        instance.dispose();
        other.dispose();
    }
});

test('environment keys preserve production aliases and isolate all non-production endpoints', () => {
    const keys = [
        'session',
        'keys.1',
        'trust.1.id:2',
        'trust.1.id:2.history.previous',
        'draft:1:dm:2',
        'notifications:1',
        'playtime.calls.1',
    ];
    const production = 'https://smeruxa.ru/playtime';
    const direct = 'https://playtime.smeruxa.ru/playtime';
    const first = 'http://10.0.2.2:1502/playtime';
    const second = 'http://10.0.2.2:1504/playtime';
    for (const key of keys) {
        assert.equal(environmentKey(production, key), key);
        assert.equal(environmentKey(direct, key), environmentKey(production, key));
        assert.equal(environmentKey(direct + '/', key), key);
        for (const unrelated of [
            'http://playtime.smeruxa.ru/playtime',
            direct + '/other',
            'https://playtime.smeruxa.ru.evil.test/playtime',
        ]) {
            assert.notEqual(environmentKey(unrelated, key), key);
        }
        assert.equal(environmentKey(production + '/', key), key);
        assert.notEqual(environmentKey(first, key), environmentKey(production, key));
        assert.notEqual(environmentKey(first, key), environmentKey(second, key));
        assert.equal(environmentKey(first + '/', key), environmentKey(first, key));
    }
    assert.throws(() => environmentKey('', 'session'));
});

test('a restored session opens the same encrypted history after changing production origins', async () => {
    await reset();
    const device = new MemoryStorage();
    function storage(base: string): SecureStorage {
        return {
            get: (key) => device.get(environmentKey(base, key)),
            set: (key, value) => device.set(environmentKey(base, key), value),
            remove: (key) => device.remove(environmentKey(base, key)),
        };
    }
    const old = client(storage('https://smeruxa.ru/playtime'));
    const upgraded = client(storage('https://playtime.smeruxa.ru/playtime'));
    const room = { id: 10, name: 'Вечерний пати', isRoom: true };
    try {
        await login(old);
        await old.openChat(room);
        await old.sendMessage('История до смены адреса');
        const original = device.values.get('keys.1');
        assert.ok(original && JSON.parse(original).dm && JSON.parse(original)['room:10']);
        old.dispose();
        await upgraded.bootstrap();
        await until(
            () => upgraded.snapshot.connection === 'online' && upgraded.snapshot.encryption.ready,
        );
        assert.equal(upgraded.snapshot.session?.user.id, 1);
        assert.equal(upgraded.snapshot.encryption.needsRecovery, false);
        await upgraded.openChat(room);
        assert.ok(upgraded.snapshot.messages.some((row) => row.text === 'История до смены адреса'));
        assert.equal(device.values.get('keys.1'), original);
    } finally {
        old.dispose();
        upgraded.dispose();
    }
});

test('reply previews resolve decrypted local history and retain safe missing-key fallbacks', () => {
    const original = messageFromWire(
        { id: 41, content: 'Local\n decrypted quote', from: 'Nova' },
        { id: 2, name: 'Nova', isRoom: false },
        'Mika',
    );
    const reply = {
        ...original,
        id: 42,
        reply: { id: 41, author: 'Nova', preview: '[Защищено сквозным шифрованием]' },
    };
    assert.equal(replyPreview(reply, [original, reply]), 'Local decrypted quote');
    assert.equal(replyPreview(reply, [{ ...original, text: 'Edited quote' }]), 'Edited quote');
    assert.equal(replyPreview(reply, []), reply.reply.preview);
    assert.equal(replyPreview(reply, [{ ...original, decryptError: true }]), reply.reply.preview);
    assert.equal(
        replyPreview(reply, [{ ...original, voice: { key: 'voice', durationSec: 2 } }]),
        'Голосовое сообщение',
    );
    assert.equal(
        replyPreview(reply, [
            {
                ...original,
                attachment: {
                    key: 'file',
                    filename: 'report.pdf',
                    mime: 'application/pdf',
                    sizeBytes: 20,
                },
            },
        ]),
        'Файл: report.pdf',
    );
});

test('room unread watermark survives pagination and realtime reload, then resets on close', async () => {
    await reset();
    const instance = client();
    const room = { id: 10, name: 'Вечерний пати', isRoom: true, createdBy: 1 };
    try {
        await login(instance);
        await instance.openChat(room);
        for (let index = 0; index < 55; index++) {
            await instance.sendMessage(`Pagination fixture ${index}`);
        }
        const initialWatermark = instance.snapshot.messages[2].id;
        const newest = instance.snapshot.messages.at(-1)!.id;
        instance.closeChat();
        await instance.ack('profile:get', {});
        fixture.state.roomReads.set('10:1', initialWatermark);
        const opening = instance.openChat(room);
        instance.setChatVisible(true);
        await opening;
        assert.equal(instance.snapshot.roomReadWatermark, initialWatermark);
        assert.equal(instance.snapshot.hasMore, true);
        assert.equal(instance.snapshot.messages.length, 50);
        await instance.loadOlder();
        assert.equal(instance.snapshot.messages.length, 56);
        assert.equal(instance.snapshot.roomReadWatermark, initialWatermark);
        const requestsBefore = fixture.state.captured.filter(
            (item) => item.event === 'message:getMessages',
        ).length;
        await fetch(`${origin}/__test/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event: 'room:membersChanged',
                userId: 1,
                payload: { roomId: 10 },
            }),
        });
        await until(
            () =>
                fixture.state.captured.filter((item) => item.event === 'message:getMessages')
                    .length > requestsBefore && !instance.snapshot.historyLoading,
        );
        assert.equal(instance.snapshot.roomReadWatermark, initialWatermark);
        instance.closeChat();
        assert.equal(instance.snapshot.roomReadWatermark, 0);
        await instance.openChat(room);
        assert.equal(instance.snapshot.roomReadWatermark, newest);
    } finally {
        instance.dispose();
    }
});

test('account-bound requests cannot use a different logged-in user after async configuration', async () => {
    await reset();
    const instance = client();
    try {
        await login(instance);
        await assert.rejects(
            instance.request('/auth/sessions', { expectedUserId: 2 }),
            /Сеанс изменился/,
        );
        const own = await instance.request<{ sessions: unknown[] }>('/auth/sessions', {
            expectedUserId: 1,
        });
        assert.ok(own.sessions.length > 0);
    } finally {
        instance.dispose();
    }
});

test('push HTTP contract registers per session, validates input and removes on opt-out/logout', async () => {
    await reset();
    const instance = client();
    try {
        await login(instance);
        const body = {
            provider: 'rustore',
            token: 'local-fixture-token-only',
            enabled: true,
            mutedChats: ['dm:Nova', 'room:10'],
        };
        const result = await instance.request('/push/device', {
            method: 'PUT',
            body,
            expectedUserId: 1,
        });
        assert.deepEqual(result, { registered: true, deliveryReady: false });
        assert.equal(fixture.state.pushDevices.size, 1);
        assert.deepEqual([...fixture.state.pushDevices.values()][0].mutedChats, body.mutedChats);
        await assert.rejects(
            instance.request('/push/device', {
                method: 'PUT',
                body: { ...body, mutedChats: ['room:-2'] },
            }),
            /Некорректные настройки/,
        );
        await instance.request('/push/device', { method: 'DELETE', expectedUserId: 1 });
        assert.equal(fixture.state.pushDevices.size, 0);
        await instance.request('/push/device', { method: 'PUT', body, expectedUserId: 1 });
        await instance.logout();
        await until(() => fixture.state.pushDevices.size === 0);
    } finally {
        instance.dispose();
    }
});

test('failed key publication rolls back imported local keys without changing remote identity', async () => {
    await reset();
    const first = client();
    const storage = new MemoryStorage();
    storage.values.set(
        'keys.1',
        JSON.stringify({
            dm: b64(nacl.box.keyPair().secretKey),
            'room:10': b64(nacl.randomBytes(32)),
        }),
    );
    const second = client(storage);
    try {
        await login(first);
        const originalPublic = first.snapshot.profile?.dmPublicKey;
        await second.login('mika@example.test', PASSWORD);
        await until(() => second.snapshot.encryption.ready);
        const previousKeys = storage.values.get('keys.1');
        const transfer = await first.createKeyTransfer();
        await fetch(`${origin}/__test/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'socketFailure', event: 'profile:setDmPublicKey' }),
        });
        await assert.rejects(second.consumeKeyTransfer(transfer.code), /временно недоступно/);
        assert.equal(storage.values.get('keys.1'), previousKeys);
        assert.equal((await first.getProfile()).dmPublicKey, originalPublic);
        assert.equal(second.snapshot.encryption.needsRecovery, true);
    } finally {
        first.dispose();
        second.dispose();
    }
});

test('encrypted sidebar media previews omit download capability without weakening full-message binding', () => {
    const sender = nacl.box.keyPair();
    const receiver = nacl.box.keyPair();
    const media = {
        kind: 'attachment' as const,
        storageKey: '1c32fe55-45c5-437b-b901-a1c3b7ca51fe',
        ...encryptMediaBytes(new Uint8Array([1, 2, 3])),
        mime: 'text/plain',
        filename: 'Readable attachment.txt',
        sizeBytes: 3,
    };
    const content = encryptDm(
        MEDIA_PREFIX + JSON.stringify(media),
        b64(receiver.publicKey),
        b64(sender.secretKey),
    );
    const wire = {
        id: 0,
        content,
        sender_username: 'Nova',
        senderDmPublicKey: b64(sender.publicKey),
    };
    const chat = { id: 2, name: 'Nova', isRoom: false };
    const preview = messageFromWire(
        wire,
        chat,
        'Mika',
        b64(receiver.secretKey),
        undefined,
        'preview',
    );
    assert.equal(preview.text, 'Readable attachment.txt');
    assert.equal(preview.decryptError, false);
    assert.equal(preview.media, undefined);
    assert.equal(preview.attachment, undefined);
    const unboundMessage = messageFromWire(wire, chat, 'Mika', b64(receiver.secretKey));
    assert.equal(unboundMessage.decryptError, true);
    assert.equal(unboundMessage.media, undefined);
    const tampered = messageFromWire(
        { ...wire, attachmentKey: 'f8271766-5dec-4e5d-8216-2fe31b63af44' },
        chat,
        'Mika',
        b64(receiver.secretKey),
    );
    assert.equal(tampered.decryptError, true);
    const bound = messageFromWire(
        { ...wire, attachmentKey: media.storageKey },
        chat,
        'Mika',
        b64(receiver.secretKey),
    );
    assert.equal(bound.media?.storageKey, media.storageKey);
});

test('expired access restores through one-time refresh rotation without persisting a password', async () => {
    await reset();
    const storage = new MemoryStorage();
    const first = client(storage);
    await login(first);
    const original = first.snapshot.session!;
    first.dispose();
    let validityRequests = 0;
    const restored = new PlayTimeClient({
        baseUrl: `${origin}/playtime`,
        socketUrl: origin,
        storage,
        fetch: (input, init) => {
            if (String(input).endsWith('/auth/tokenValid') && validityRequests++ === 0) {
                return Promise.resolve(
                    new Response(JSON.stringify({ valid: false }), { status: 401 }),
                );
            }
            return fetch(input, init);
        },
    });
    try {
        await restored.bootstrap();
        await until(() => restored.snapshot.connection === 'online');
        assert.equal(restored.snapshot.session?.user.id, original.user.id);
        assert.notEqual(restored.snapshot.session?.refreshToken, original.refreshToken);
        const replay = await fetch(`${origin}/playtime/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: original.refreshToken }),
        });
        assert.equal(replay.status, 401);
        assert.ok([...storage.values.values()].every((value) => !value.includes(PASSWORD)));
        assert.equal(
            JSON.parse(storage.values.get('session')!).refreshToken,
            restored.snapshot.session?.refreshToken,
        );
    } finally {
        restored.dispose();
    }
});

test('protocol: unauthenticated foreground preserves auth flow; login/logout remove another account draft', async () => {
    await reset();
    const storage = new MemoryStorage();
    const instance = client(storage);
    try {
        await instance.bootstrap();
        await instance.authFlow.save({
            mode: 'verify',
            email: 'pending-other@example.test',
            username: 'PendingOther',
            resendAt: Date.now() + 60000,
        });
        let restartedBootstrap = false;
        const unsubscribe = instance.subscribe((state) => {
            if (state.bootstrapping) restartedBootstrap = true;
        });
        instance.setForeground(false);
        instance.setForeground(true);
        await new Promise((resolve) => setTimeout(resolve, 40));
        unsubscribe();
        assert.equal(
            restartedBootstrap,
            false,
            'Foreground must not unmount the unauthenticated form',
        );
        assert.equal((await instance.authFlow.load())?.email, 'pending-other@example.test');
        await login(instance);
        assert.equal(await instance.authFlow.load(), null);
        await instance.authFlow.save({
            mode: 'register',
            email: 'obsolete@example.test',
            username: '',
            resendAt: 0,
        });
        await instance.logout();
        assert.equal(await instance.authFlow.load(), null);
        assert.equal(storage.values.has('session'), false);
    } finally {
        instance.dispose();
    }
});

test('incoming friendship endpoint is normalized before notification routing and chat identity', async () => {
    await reset();
    const instance = client();
    try {
        await login(instance);
        const incoming = instance.snapshot.incoming.find(
            (friend) => friend.friend_username === 'Luna',
        );
        assert.equal(incoming?.user_id, 4);
        assert.equal(
            incoming?.friend_id,
            4,
            'incoming relationship friend_id is our own ID on the wire',
        );
        await instance.friendAction('accept', 'Luna');
        const peer = instance.snapshot.friends.find((friend) => friend.friend_username === 'Luna');
        assert.equal(peer?.friend_id, 4);
        assert.equal(
            instance.snapshot.friends.find((friend) => friend.friend_username === 'Nova')
                ?.friend_id,
            2,
        );
        const target = {
            version: 1 as const,
            userId: 1,
            kind: 'chat' as const,
            id: 4,
            name: 'Luna',
            isRoom: false,
        };
        const chat = resolveNotificationChat(target, instance.snapshot);
        assert.deepEqual(chat, { id: 4, name: 'Luna', isRoom: false, archived: false });
        assert.equal(
            resolveMessageChat(
                { id: 9001, sender_id: 4, sender_username: 'Luna', content: 'ciphertext' },
                instance.snapshot,
            )?.id,
            4,
        );
        assert.equal(resolveNotificationChat({ ...target, id: 1 }, instance.snapshot), null);
        await instance.openChat(chat!);
        assert.equal(instance.snapshot.currentChat?.id, 4);
    } finally {
        await instance.logout();
        instance.dispose();
    }
});

test('protocol: ID presence uses the callback-only production handler', async () => {
    await reset();
    const instance = client();
    try {
        await instance.login('mika@example.test', PASSWORD);
        await until(
            () => instance.snapshot.connection === 'online' && instance.snapshot.encryption.ready,
        );
        const ids = await instance.ack<number[]>('presence:listByUserId');
        assert.ok(ids.includes(2));
        await instance.refreshHome();
        assert.ok(instance.snapshot.friends.some((friend) => friend.friend_id === 2));
        assert.ok(instance.snapshot.subscription);
    } finally {
        instance.dispose();
    }
});
