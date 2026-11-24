import assert from 'node:assert/strict';
import { test } from 'node:test';
import nacl from 'tweetnacl';
import { PeerIdentity } from '../src/services/peerIdentity';
import { RoomKeys } from '../src/services/roomKeys';
import { KeyVault, type SecureStorage } from '../src/services/storage';
import { b64, encryptDmBytes } from '../src/services/crypto';
import { chatKey } from '../src/services/chatIdentity';
import { messageMatches } from '../src/services/messages';
import { RealtimeEvents } from '../src/services/realtime';
import { ChatService } from '../src/services/chat';
import type { FeatureHost } from '../src/services/featureHost';

test('reclaimed nickname cannot route a new holder into archived history or cache', () => {
    const archived = { id: 2, name: 'Nova', isRoom: false, archived: true };
    const replacement = { id: 9, name: 'Nova', isRoom: false };
    assert.notEqual(chatKey(archived), chatKey(replacement));
    assert.equal(
        messageMatches(
            { sender_id: 9, receiver_id: 1, sender_username: 'Nova', receiver_username: 'Mika' },
            archived,
            'Mika',
        ),
        false,
    );
    assert.equal(
        messageMatches(
            {
                sender_id: 2,
                receiver_id: 1,
                sender_username: 'old-internal-name',
                receiver_username: 'Mika',
            },
            archived,
            'Mika',
        ),
        true,
    );
    assert.equal(
        messageMatches({ sender_username: 'Nova', receiver_username: 'Mika' }, archived, 'Mika'),
        false,
    );
});

test('archived DM retains stable history routing and refuses writes before encryption', async () => {
    const emitted: { event: string; payload: unknown }[] = [];
    const chat = { id: 2, name: 'Nova', isRoom: false, archived: true };
    const host = {
        snapshot: { currentChat: chat, messages: [], previews: {} },
        foreground: true,
        chatVisible: true,
        update: () => {},
        waitEvent: async (_event: string, _predicate: unknown, fire: () => void) => {
            fire();
            return { messages: [] };
        },
        emit: (event: string, payload: unknown) => {
            emitted.push({ event, payload });
        },
        ack: async () => ({}),
    } as unknown as FeatureHost;
    const service = new ChatService(host);
    await service.reloadHistory();
    assert.equal((emitted[0].payload as { peerUserId: number }).peerUserId, 2);
    await assert.rejects(service.sendMessage('must not reach the new Nova'), /Гость вышел/);
    await assert.rejects(service.setWallpaper({ kind: 'none' }), /Гость вышел/);
    assert.deepEqual(
        emitted.map((item) => item.event),
        ['message:getMessages'],
    );
});

test('new nickname holder updates only its own preview, never the archived conversation', async () => {
    const state = {
        session: { user: { id: 1, username: 'Mika' } },
        currentChat: { id: 2, name: 'Nova', isRoom: false, archived: true },
        rooms: [],
        messages: [],
        previews: {},
    };
    const host = {
        snapshot: state,
        foreground: true,
        chatVisible: true,
        update: (patch: object) => Object.assign(state, patch),
        decode: () => ({ id: 10, text: 'new holder', data: 1, me: false }),
        markRead: () => {
            throw new Error('must not mark archived peer read');
        },
    } as unknown as import('../src/services/realtime').RealtimeHost;
    await new RealtimeEvents(host).receiveMessage({
        id: 10,
        content: 'new holder',
        sender_id: 9,
        receiver_id: 1,
        sender_username: 'Nova',
        receiver_username: 'Mika',
    });
    assert.deepEqual(state.messages, []);
    assert.equal(Object.hasOwn(state.previews, 'dm:2'), false);
    assert.equal(Object.hasOwn(state.previews, 'dm:9'), true);
});

test('concurrent first-use observations keep one pin and old identities authenticate only history', async () => {
    const pins = new Map<string, string>();
    const state = { encryption: {} };
    const host = {
        generation: 1,
        snapshot: state,
        assertSession: () => ({ user: { id: 1 } }),
        storage: {
            get: async (key: string) => pins.get(key) ?? null,
            set: async (key: string, value: string) => {
                pins.set(key, value);
            },
        },
        update: (patch: object) => Object.assign(state, patch),
    };
    const identity = new PeerIdentity(host as unknown as FeatureHost);
    const oldKey = b64(nacl.box.keyPair().publicKey);
    const nextKey = b64(nacl.box.keyPair().publicKey);
    const observations = await Promise.allSettled([
        identity.checkPeerIdentity('Nova', 2, oldKey),
        identity.checkPeerIdentity('Nova', 2, nextKey),
    ]);
    assert.deepEqual(
        observations.map((result) => result.status),
        ['fulfilled', 'rejected'],
    );
    assert.equal(pins.get('trust.1.id:2'), oldKey);
    await identity.trustChangedPeer(nextKey);
    assert.equal(await identity.checkPeerIdentity('Nova', 2, oldKey, true), oldKey);
    await assert.rejects(identity.checkPeerIdentity('Nova', 2, oldKey), /изменился/);
    const pending = identity.checkPeerIdentity('Other', 3, oldKey);
    host.generation++;
    await assert.rejects(pending, /Аккаунт/);
    assert.equal(pins.has('trust.1.id:3'), false);
});

test('a historical wrapper cannot distribute the current room key and removal purges every local epoch', async () => {
    const own = nacl.box.keyPair();
    const oldPeer = nacl.box.keyPair();
    const newPeer = nacl.box.keyPair();
    const roomSecret = nacl.randomBytes(32);
    const pins = new Map<string, string>();
    const storage: SecureStorage = {
        get: async (key) => pins.get(key) ?? null,
        set: async (key, value) => {
            pins.set(key, value);
        },
        remove: async (key) => {
            pins.delete(key);
        },
    };
    const vault = new KeyVault(storage);
    await vault.load(1);
    const state = { encryption: {} };
    const oldKey = b64(oldPeer.publicKey);
    const nextKey = b64(newPeer.publicKey);
    const host = {
        generation: 1,
        storage,
        vault,
        snapshot: state,
        assertSession: () => ({ user: { id: 1 } }),
        assertEncryption: () => b64(own.secretKey),
        update: (patch: object) => Object.assign(state, patch),
        ack: async (_: string, payload: { epoch?: number }) => ({
            epoch: payload.epoch ?? 2,
            currentEpoch: 2,
            wrapCount: 2,
            members: [{ id: 2, username: 'Nova', dmPublicKey: nextKey }],
            myWrap: {
                ciphertext: encryptDmBytes(roomSecret, b64(own.publicKey), b64(oldPeer.secretKey)),
                wrapperUserId: 2,
                wrapperDmPublicKey: oldKey,
            },
        }),
    };
    const identity = new PeerIdentity(host as unknown as FeatureHost);
    const keys = new RoomKeys(host as unknown as FeatureHost, identity);
    await identity.checkPeerIdentity('Nova', 2, oldKey);
    await assert.rejects(identity.checkPeerIdentity('Nova', 2, nextKey));
    await identity.trustChangedPeer(nextKey);
    await assert.rejects(keys.ensureRoomKey(10), /изменился/);
    assert.equal((await keys.ensureRoomKey(10, 1)).key, b64(roomSecret));
    await vault.write('room:10', b64(roomSecret));
    await vault.write('room:100:1', b64(roomSecret));
    await Promise.all([vault.forgetRoom(10), vault.write('room:11:2', b64(roomSecret))]);
    assert.deepEqual(Object.keys(vault.snapshot()).sort(), ['room:100:1', 'room:11:2']);
});
