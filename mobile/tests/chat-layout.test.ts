import assert from 'node:assert/strict';
import test from 'node:test';
import {
    messagesGrouped,
    sameMessageDay,
    searchMessages,
    startsUnreadMessages,
} from '../src/features/chat/messageLayout';
import { loadMessage } from '../src/features/chat/loadMessage';
import {
    parseNotificationTarget,
    resolveNotificationChat,
    resolveMessageChat,
} from '../src/platform/notificationTarget';
import { getChatEmojiList } from '../../apps/frontend/src/features/chat/emoji/emojiDataset';
import { EMOJI_CATALOG } from '../src/features/chat/emojiCatalog';
import { initialSnapshot } from '../src/services/snapshot';
import type { ClientSnapshot, Message } from '../src/types';

const message = (override: Partial<Message> = {}): Message => ({
    id: 1,
    me: false,
    text: 'Сообщение',
    data: new Date(2026, 10, 10, 12, 0).getTime(),
    from: 'Nova',
    read: false,
    reactions: [],
    ...override,
});

test('room grouping respects authors, five-minute windows, date boundaries and system events', () => {
    const first = message();
    assert.equal(messagesGrouped(message({ data: first.data + 5000 }), first, true), true);
    assert.equal(messagesGrouped(message({ from: 'Orbit' }), first, true), false);
    assert.equal(messagesGrouped(message({ data: first.data + 300001 }), first, true), false);
    assert.equal(messagesGrouped(message({ isThreadOp: true }), first, true), false);
    assert.equal(messagesGrouped(message({ me: true }), first, false), false);
    assert.equal(
        sameMessageDay(
            new Date(2026, 10, 10, 23, 59).getTime(),
            new Date(2026, 10, 11, 0, 0).getTime(),
        ),
        false,
    );
});

test('search includes attachment names, preserves chronology and omits unreadable ciphertext', () => {
    const messages = [
        message({ id: 4, text: 'ПЛАН на вечер' }),
        message({ id: 5, text: 'план', decryptError: true }),
        message({
            id: 6,
            text: '',
            attachment: { key: 'x', mime: 'application/pdf', filename: 'План.pdf', sizeBytes: 10 },
        }),
    ];
    assert.deepEqual(searchMessages(messages, '  план '), [4, 6]);
    assert.deepEqual(searchMessages(messages, '  '), []);
});

test('room unread boundary appears once and does not group across the read watermark', () => {
    const before = message({ id: 40 });
    const first = message({ id: 42 });
    assert.equal(startsUnreadMessages(first, before, 40), true);
    assert.equal(startsUnreadMessages(message({ id: 43 }), first, 40), false);
    assert.equal(startsUnreadMessages(first, undefined, 40), false);
    assert.equal(startsUnreadMessages(first, before, 0), false);
    assert.equal(startsUnreadMessages(first, message({ id: 40, isThreadOp: true }), 40), false);
});

test('reply jump loads just enough history, stops for deleted messages and cancels on navigation', async () => {
    let requests = 0;
    let active = true;
    const source = {
        snapshot: { messages: [message({ id: 100 })], hasMore: true, historyLoading: false },
        loadOlder: async () => {
            requests++;
            source.snapshot.messages.unshift(message({ id: requests === 1 ? 50 : 10 }));
        },
    };
    assert.equal(await loadMessage(50, source, () => active), true);
    assert.equal(requests, 1);
    await assert.rejects(
        loadMessage(60, source, () => active),
        /удалено|недоступно/,
    );
    assert.equal(requests, 1);
    source.loadOlder = async () => {
        requests++;
        active = false;
    };
    assert.equal(await loadMessage(10, source, () => active), false);
    assert.equal(requests, 2);
});

test('history jump rejects a stalled page rather than repeatedly fetching it', async () => {
    let requests = 0;
    const source = {
        snapshot: { messages: [message({ id: 100 })], hasMore: true, historyLoading: false },
        loadOlder: async () => {
            requests++;
        },
    };
    await assert.rejects(
        loadMessage(50, source, () => true),
        /загрузить предыдущие/,
    );
    assert.equal(requests, 1);
});

test('Android catalog contains every desktop emoji with intact ZWJ and variation sequences', () => {
    assert.deepEqual(EMOJI_CATALOG, getChatEmojiList());
    assert.ok(EMOJI_CATALOG.includes('❤️‍🔥'));
    assert.ok(EMOJI_CATALOG.includes('🐕‍🦺'));
});

function snapshot(): ClientSnapshot {
    return {
        ...initialSnapshot(),
        session: {
            token: 'test',
            refreshToken: 'test',
            expiresIn: 3600,
            user: { id: 1, email: 'mika@example.test', username: 'Mika' },
        },
        friends: [
            { id: 10, user_id: 1, friend_id: 2, friend_username: 'Nova', status: 'accepted' },
        ],
        rooms: [{ id: 101, name: 'Room', created_by: 1 }],
    };
}

test('notification navigation rejects malformed data, another account and revoked membership', () => {
    assert.equal(parseNotificationTarget('not-json'), null);
    assert.equal(
        parseNotificationTarget(JSON.stringify({ version: 2, userId: 1, kind: 'call' })),
        null,
    );
    const valid = parseNotificationTarget(
        JSON.stringify({ version: 1, userId: 1, kind: 'chat', id: 2, name: 'Nova', isRoom: false }),
    );
    assert.ok(valid);
    assert.equal(resolveNotificationChat(valid, snapshot())?.name, 'Nova');
    assert.equal(resolveNotificationChat({ ...valid, userId: 9 }, snapshot()), null);
    assert.equal(resolveNotificationChat(valid, { ...snapshot(), friends: [] }), null);
});

test('own messages and unknown senders never become incoming notifications', () => {
    assert.equal(
        resolveMessageChat({ id: 1, content: 'cipher', sender_username: 'Mika' }, snapshot()),
        null,
    );
    assert.equal(
        resolveMessageChat({ id: 2, content: 'cipher', sender_username: 'Unknown' }, snapshot()),
        null,
    );
    assert.equal(
        resolveMessageChat(
            { id: 3, content: 'cipher', sender_username: 'Nova', sender_id: 2 },
            snapshot(),
        )?.id,
        2,
    );
});
