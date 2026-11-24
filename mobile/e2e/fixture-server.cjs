const http = require('node:http');
const { registerFixtureCalls } = require('./fixture-calls.cjs');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const backendRequire = createRequire(require.resolve('../../apps/package.json'));
const { Server } = backendRequire('socket.io');
const express = backendRequire('express');
const multer = backendRequire('multer');
const nacl = require('tweetnacl');
const util = require('tweetnacl-util');

const CODE = '012345';
const PASSWORD = 'PlayTime-test-123';
const uuid = () => crypto.randomUUID();
const encoded = util.encodeBase64;
const decoded = util.decodeBase64;
const userKey = (id) => String(id);
const dmKey = (a, b) => [a, b].sort((x, y) => x - y).join(':');
const fixedPair = (number) => nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(number));
const now = () => new Date().toISOString();
const plans = require('./fixture-plans.json');
const limits = plans.pro;

function encryptDm(plaintext, senderSecret, receiverPublic) {
    const nonce = nacl.randomBytes(24);
    const ciphertext = nacl.box(
        util.decodeUTF8(plaintext),
        nonce,
        decoded(receiverPublic),
        senderSecret,
    );
    return 'E2E1:' + JSON.stringify({ n: encoded(nonce), b: encoded(ciphertext) });
}

function encryptRoom(plaintext, key) {
    const nonce = nacl.randomBytes(24);
    return (
        'R2E1:' +
        JSON.stringify({
            n: encoded(nonce),
            b: encoded(nacl.secretbox(util.decodeUTF8(plaintext), nonce, key)),
        })
    );
}

function profile(username, id) {
    return {
        username,
        email: `${username.toLowerCase()}@example.test`,
        status: username === 'Mika' ? 'Время быть на связи' : 'На одной волне',
        bio:
            username === 'Mika'
                ? 'Игры, музыка и хорошие разговоры.'
                : 'Собираемся вечером в PlayTime 🎮',
        avatar: null,
        profileBanner: null,
        profileAvatarEffect: 'none',
        profileBannerEffect: 'none',
        profileBannerSticker: 'none',
        createdAt: '2026-10-01T10:00:00.000Z',
        isSelf: false,
        id,
    };
}

function seedState() {
    const users = new Map();
    for (const [id, username] of [
        [1, 'Mika'],
        [2, 'Nova'],
        [3, 'Orbit'],
        [4, 'Luna'],
        [5, 'Echo'],
    ]) {
        const keyPair = fixedPair(id);
        users.set(id, {
            ...profile(username, id),
            password: PASSWORD,
            verified: true,
            keyPair,
            dmPublicKey: id === 1 ? null : encoded(keyPair.publicKey),
        });
    }
    return {
        users,
        friendships: [
            { id: 1, user_id: 1, friend_id: 2, status: 'accepted' },
            { id: 2, user_id: 1, friend_id: 3, status: 'accepted' },
            { id: 3, user_id: 4, friend_id: 1, status: 'pending' },
            { id: 4, user_id: 1, friend_id: 5, status: 'pending' },
        ],
        rooms: new Map([
            [
                10,
                {
                    id: 10,
                    name: 'Вечерний пати',
                    created_by: 1,
                    members: [
                        { id: 1, username: 'Mika', role: 'member' },
                        { id: 2, username: 'Nova', role: 'member' },
                        { id: 3, username: 'Orbit', role: 'member' },
                    ],
                    key: new Uint8Array(32).fill(71),
                    wraps: {},
                    pinned: null,
                },
            ],
        ]),
        messages: [],
        receipts: new Map(),
        roomReads: new Map(),
        captured: [],
        requests: [],
        wallpapers: new Map(),
        pins: new Map(),
        blocks: new Map(),
        reports: [],
        tokens: new Map(),
        refreshTokens: new Map(),
        sessions: new Map(),
        pushDevices: new Map(),
        challenges: new Map(),
        transfers: new Map(),
        uploads: new Map(),
        nextMessageId: 1,
        nextRoomId: 20,
        nextUserId: 6,
        seeded: false,
        call: null,
        failures: {},
        socketFailures: {},
        planSlug: 'pro',
        roomListDelayMs: 0,
    };
}

function createFixtureServer({ port = 1502, host = '127.0.0.1' } = {}) {
    let state = seedState();
    const app = express();
    const server = http.createServer(app);
    const io = new Server(server, {
        path: '/playtime/socket.io',
        cors: { origin: true },
        maxHttpBufferSize: 1024 * 1024,
    });
    app.use(express.json({ limit: '1mb' }));

    const findUser = (username) =>
        [...state.users.values()].find((user) => user.username === username);
    const emitUser = (id, event, data) => io.to(userKey(id)).emit(event, data);
    const emitRoom = (id, event, data) =>
        state.rooms.get(id)?.members.forEach((member) => emitUser(member.id, event, data));
    const friendList = (uid) =>
        state.friendships
            .filter((friend) => friend.user_id === uid || friend.friend_id === uid)
            .map((friend) => {
                const otherId = friend.user_id === uid ? friend.friend_id : friend.user_id;
                return {
                    ...friend,
                    friend_username: state.users.get(otherId)?.username,
                    friend_archived: !!state.users.get(otherId)?.archived,
                    direction: friend.user_id === uid ? 'outgoing' : 'incoming',
                    is_room: false,
                    other_user_id: otherId,
                };
            });
    const friends = (a, b) =>
        state.friendships.some(
            (friend) =>
                friend.status === 'accepted' &&
                dmKey(friend.user_id, friend.friend_id) === dmKey(a, b),
        );
    const emitFriendsUpdated = () => io.emit('friend:list:updated');
    function rotateRoomKey(room) {
        if (
            !Object.keys(room.wraps).length &&
            !state.messages.some((message) => message.roomId === room.id)
        )
            return;
        room.keyHistory ??= {};
        room.keyHistory[room.epoch ?? 0] = room.wraps;
        room.epoch = (room.epoch ?? 0) + 1;
        room.wraps = {};
    }
    const visibleMessages = (uid, data) =>
        state.messages.filter((message) =>
            data.roomId != null
                ? message.roomId === data.roomId &&
                  state.rooms
                      .get(data.roomId)
                      ?.members.some(
                          (member) =>
                              member.id === uid && message.id > (member.visibleAfterId ?? 0),
                      )
                : message.roomId == null &&
                  dmKey(message.senderId, message.receiverId) ===
                      dmKey(uid, data.peerUserId ?? findUser(data.username)?.id),
        );
    const toHistory = (message, uid) => ({
        ...message,
        sender_id: message.senderId,
        receiver_id: message.receiverId,
        me: message.senderId === uid,
        sender_dm_public_key: message.senderDmPublicKey,
        receiver_dm_public_key: message.receiverDmPublicKey,
        reply_to_id: message.reply?.id,
        reply_sender_username: message.reply?.from,
        reply_preview: message.reply?.preview,
        reactions_json: message.reactions ?? [],
        voice_storage_key: message.voiceStorageKey,
        voice_duration_sec: message.voiceDurationSec,
        attachment_storage_key: message.attachmentKey,
        attachment_mime: message.attachmentMime,
        attachment_filename: message.attachmentFilename,
        attachment_size: message.attachmentSize,
    });
    const publicProfile = (user, uid) => {
        const { password, keyPair, verified, ...result } = user;
        return {
            ...result,
            email: uid === user.id ? user.email : undefined,
            dmPublicKey: uid === user.id ? user.dmPublicKey : undefined,
            isSelf: uid === user.id,
        };
    };
    const startSession = (user, sessionId = uuid()) => {
        const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(
            JSON.stringify({
                id: user.id,
                username: user.username,
                exp: Math.floor(Date.now() / 1000) + 3600,
            }),
        ).toString('base64url')}.${crypto.randomBytes(12).toString('hex')}`;
        const refreshToken = crypto.randomBytes(32).toString('hex');
        state.tokens.set(token, { userId: user.id, sessionId });
        state.refreshTokens.set(refreshToken, { userId: user.id, sessionId });
        const session = state.sessions.get(sessionId);
        state.sessions.set(sessionId, {
            id: sessionId,
            userId: user.id,
            deviceName: session?.deviceName ?? 'PlayTime · Android',
            createdAt: session?.createdAt ?? now(),
            lastSeenAt: now(),
        });
        if (![...state.sessions.values()].some((item) => item.deviceName === 'PlayTime · macOS')) {
            const desktopId = uuid();
            state.sessions.set(desktopId, {
                id: desktopId,
                userId: user.id,
                deviceName: 'PlayTime · macOS',
                createdAt: '2026-10-01T10:00:00.000Z',
                lastSeenAt: now(),
            });
        }
        return {
            token,
            refreshToken,
            expiresIn: 3600,
            user: { id: user.id, username: user.username, email: user.email },
        };
    };
    const revoke = (sessionId) => {
        for (const [token, value] of state.tokens)
            if (value.sessionId === sessionId) state.tokens.delete(token);
        for (const [token, value] of state.refreshTokens)
            if (value.sessionId === sessionId) state.refreshTokens.delete(token);
        state.sessions.delete(sessionId);
        state.pushDevices.delete(sessionId);
        for (const socket of io.sockets.sockets.values())
            if (socket.data.sessionId === sessionId) {
                socket.emit('session:revoked');
                socket.disconnect(true);
            }
    };
    const authorize = (req, res, next) => {
        const auth = state.tokens.get(
            String(req.headers.authorization ?? '').replace(/^Bearer /, ''),
        );
        if (!auth) return res.status(401).json({ error: 'Сеанс истёк' });
        req.auth = auth;
        req.user = state.users.get(auth.userId);
        if (!req.user) return res.status(401).json({ error: 'Аккаунт удалён' });
        next();
    };

    function seedEncryptedHistory() {
        if (state.seeded) return;
        const me = state.users.get(1),
            nova = state.users.get(2);
        if (!me.dmPublicKey) return;
        state.seeded = true;
        const texts = [
            'Привет! Сегодня собираемся поиграть? 🎮',
            'Да, буду после восьми. Возьмём ещё Orbit?',
            'Отличный план. Я создала комнату — заглядывай!',
        ];
        for (const [index, content] of texts.entries()) {
            const own = index === 1;
            state.messages.push({
                id: state.nextMessageId++,
                senderId: own ? 1 : 2,
                receiverId: own ? 2 : 1,
                sender_username: own ? 'Mika' : 'Nova',
                receiver_username: own ? 'Nova' : 'Mika',
                content: encryptDm(content, nova.keyPair.secretKey, me.dmPublicKey),
                is_dm_e2ee: true,
                senderDmPublicKey: own ? me.dmPublicKey : nova.dmPublicKey,
                receiverDmPublicKey: own ? nova.dmPublicKey : me.dmPublicKey,
                created_at: new Date(Date.now() - (3 - index) * 60000).toISOString(),
                read: true,
                reactions: index === 2 ? [{ emoji: '🎮', by: 'Orbit' }] : [],
            });
        }
        const room = state.rooms.get(10);
        for (const member of room.members) {
            const user = state.users.get(member.id);
            if (user.dmPublicKey) {
                const nonce = nacl.randomBytes(24);
                room.wraps[member.id] = {
                    ciphertext:
                        'E2E1:' +
                        JSON.stringify({
                            n: encoded(nonce),
                            b: encoded(
                                nacl.box(
                                    room.key,
                                    nonce,
                                    decoded(user.dmPublicKey),
                                    nova.keyPair.secretKey,
                                ),
                            ),
                        }),
                    wrapperDmPublicKey: nova.dmPublicKey,
                    wrapperUserId: nova.id,
                };
            }
        }
        state.messages.push({
            id: state.nextMessageId++,
            senderId: 2,
            sender_id: 2,
            receiver_id: 1,
            from: 'Nova',
            sender_username: 'Nova',
            roomId: 10,
            content: encryptRoom(
                'Добро пожаловать в нашу комнату. Здесь можно и переписываться, и созваниваться ✨',
                room.key,
            ),
            created_at: new Date(Date.now() - 40000).toISOString(),
            read: true,
            reactions: [],
        });
    }

    app.post('/__test/reset', (_req, res) => {
        io.disconnectSockets(true);
        state = seedState();
        res.json({ ok: true });
    });
    app.get('/__test/state', (_req, res) =>
        res.json({
            users: [...state.users.values()].map((user) => ({
                id: user.id,
                username: user.username,
                email: user.email,
                verified: user.verified,
                dmPublicKey: user.dmPublicKey,
            })),
            friendships: state.friendships,
            rooms: [...state.rooms.values()].map(({ key, wraps, ...room }) => room),
            messages: state.messages,
            captured: state.captured,
            requests: state.requests,
            uploads: [...state.uploads.entries()].map(([key, value]) => ({
                key,
                bytes: value.bytes.length,
                userId: value.userId,
            })),
            sessions: [...state.sessions.values()],
            reports: state.reports,
            verificationCode: CODE,
            call: state.call,
        }),
    );
    app.post('/__test/events', (req, res) => {
        const data = req.body;
        if (data.action === 'archiveGuestAndReclaim') {
            const old = state.users.get(2);
            old.archived = true;
            const keyPair = fixedPair(20);
            state.users.set(20, {
                ...profile('Nova', 20),
                password: PASSWORD,
                verified: true,
                keyPair,
                dmPublicKey: encoded(keyPair.publicKey),
            });
            state.friendships.push({ id: 20, user_id: 1, friend_id: 20, status: 'accepted' });
            emitFriendsUpdated();
        } else if (data.action === 'rotatePeerKey') {
            const peer = findUser(data.username ?? 'Nova');
            peer.keyPair = nacl.box.keyPair();
            peer.dmPublicKey = encoded(peer.keyPair.publicKey);
        } else if (data.action === 'disconnect') {
            io.disconnectSockets(true);
        } else if (data.action === 'revoke') {
            for (const item of [...state.sessions.values()])
                if (item.userId === (data.userId ?? 1)) revoke(item.id);
        } else if (data.action === 'incomingMessage') {
            const sender = findUser(data.from ?? 'Nova'),
                receiver = state.users.get(data.userId ?? 1);
            const message = {
                id: state.nextMessageId++,
                senderId: sender.id,
                sender_id: sender.id,
                receiver_id: receiver.id,
                receiverId: receiver.id,
                sender_username: sender.username,
                receiver_username: receiver.username,
                content: encryptDm(
                    data.text ?? 'Новое сообщение',
                    sender.keyPair.secretKey,
                    receiver.dmPublicKey,
                ),
                is_dm_e2ee: true,
                senderDmPublicKey: sender.dmPublicKey,
                receiverDmPublicKey: receiver.dmPublicKey,
                created_at: now(),
                read: false,
                reactions: [],
            };
            state.messages.push(message);
            emitUser(receiver.id, 'message:receive', message);
        } else if (data.action === 'incomingCall') {
            state.call = {
                roomId: `2:1:${uuid()}`,
                status: 'request_receiver',
                revision: 1,
                caller: { id: 2, username: 'Nova' },
                receiver: { id: 1, username: 'Mika' },
                expiresAt: Date.now() + 60000,
            };
            emitUser(1, 'call:state', state.call);
            emitUser(2, 'call:state', state.call);
            emitUser(1, 'call:incomingCall', {
                from: 'Nova',
                roomId: state.call.roomId,
                expiresAt: state.call.expiresAt,
            });
        } else if (data.action === 'confirmCall' && state.call) {
            state.call.status = 'in_call';
            state.call.revision++;
            io.emit('call:state', state.call);
            io.emit('call:confirmed', { roomId: state.call.roomId });
        } else if (data.action === 'endCall' && state.call) {
            io.emit('call:ended', { roomId: state.call.roomId });
            state.call = null;
        } else if (data.action === 'failure') {
            state.failures[data.path] = data.status ?? 503;
        } else if (data.action === 'socketFailure') {
            state.socketFailures[data.event] = data.message ?? 'Тест: действие временно недоступно';
        } else if (data.action === 'clearFailures') {
            state.failures = {};
            state.socketFailures = {};
        } else if (data.action === 'plan') {
            state.planSlug = data.planSlug;
            io.emit('subscription:planChanged', { planSlug: data.planSlug });
        } else if (data.event) {
            emitUser(data.userId ?? 1, data.event, data.payload);
        }
        res.json({ ok: true });
    });
    app.use('/playtime', (req, res, next) => {
        const request = { method: req.method, path: req.path, at: now(), status: null };
        state.requests.push(request);
        res.on('finish', () => {
            request.status = res.statusCode;
        });
        const status = state.failures[req.path];
        if (status) return res.status(status).json({ error: 'Тест: сервер временно недоступен' });
        next();
    });
    app.get('/playtime/health', (_req, res) => res.json({ ok: true, fixture: true }));
    app.post('/playtime/auth/login', (req, res) => {
        const user = [...state.users.values()].find(
            (item) => item.email === req.body.email?.trim().toLowerCase(),
        );
        if (!user || user.password !== req.body.password)
            return res.status(401).json({ error: 'Неверный email или пароль.' });
        if (!user.verified)
            return res
                .status(403)
                .json({ error: 'Подтвердите почту кодом из письма', verificationRequired: true });
        res.json(startSession(user));
    });
    app.post('/playtime/auth/register', (req, res) => {
        const { username, email, password } = req.body;
        if (!username || username.length < 3 || username.length > 15 || /\s/.test(username))
            return res.status(400).json({ error: 'Никнейм: от 3 до 15 символов без пробелов' });
        if (!email?.includes('@')) return res.status(400).json({ error: 'Некорректный email' });
        if (
            typeof password !== 'string' ||
            password.length < 12 ||
            password.length > 50 ||
            Buffer.byteLength(password) > 72
        )
            return res.status(400).json({ error: 'Пароль должен содержать от 12 до 50 символов' });
        if (
            [...state.users.values()].some(
                (user) => user.username === username || user.email === email,
            )
        )
            return res.status(400).json({ error: 'Никнейм/почта уже заняты.' });
        const id = state.nextUserId++;
        const user = {
            ...profile(username, id),
            email,
            password,
            verified: false,
            dmPublicKey: null,
            keyPair: nacl.box.keyPair(),
        };
        state.users.set(id, user);
        res.json({ user: { id, username, email }, verificationRequired: true });
    });
    app.post('/playtime/auth/tokenValid', (req, res) => {
        const auth = state.tokens.get(req.body.token);
        if (!auth) return res.status(401).json({ valid: false });
        const user = state.users.get(auth.userId);
        res.json({ valid: true, user: { id: user.id, username: user.username } });
    });
    app.post('/playtime/auth/refresh', (req, res) => {
        const auth = state.refreshTokens.get(req.body.refreshToken);
        if (!auth) return res.status(401).json({ error: 'Сеанс истёк' });
        state.refreshTokens.delete(req.body.refreshToken);
        res.json(startSession(state.users.get(auth.userId), auth.sessionId));
    });
    app.post('/playtime/auth/revoke', (req, res) => {
        const auth =
            state.tokens.get(req.body.token) ?? state.refreshTokens.get(req.body.refreshToken);
        if (auth) revoke(auth.sessionId);
        res.json({ ok: true });
    });
    for (const path of ['email-verification/request', 'recovery/request'])
        app.post(`/playtime/auth/${path}`, (_req, res) => res.json({ ok: true }));
    app.post('/playtime/auth/email-verification/confirm', (req, res) => {
        const user = [...state.users.values()].find((item) => item.email === req.body.email);
        if (!user || req.body.code !== CODE)
            return res
                .status(400)
                .json({ error: 'Неверный или просроченный код. Запросите новый.' });
        user.verified = true;
        res.json({ ok: true });
    });
    app.post('/playtime/auth/recovery/reset', (req, res) => {
        const user = [...state.users.values()].find((item) => item.email === req.body.email);
        if (!user || req.body.code !== CODE)
            return res.status(400).json({ error: 'Неверный или просроченный код.' });
        if (req.body.password?.length < 12)
            return res.status(400).json({ error: 'Пароль должен содержать от 12 до 50 символов' });
        user.password = req.body.password;
        user.verified = true;
        for (const item of [...state.sessions.values()])
            if (item.userId === user.id) revoke(item.id);
        res.json({ ok: true });
    });
    app.get('/playtime/subscription/me', authorize, (_req, res) =>
        res.json({
            planSlug: state.planSlug,
            limits: plans[state.planSlug] ?? plans.free,
        }),
    );
    app.get('/playtime/auth/sessions', authorize, (req, res) =>
        res.json({
            sessions: [...state.sessions.values()]
                .filter((item) => item.userId === req.user.id)
                .map((item) => ({ ...item, current: item.id === req.auth.sessionId })),
        }),
    );
    app.post('/playtime/auth/sessions/revocation-code', authorize, (req, res) => {
        const challengeId = uuid();
        state.challenges.set(challengeId, {
            userId: req.user.id,
            sessionId: req.body.allOthers ? null : req.body.sessionId,
        });
        res.json({
            challengeId,
            email: 'mi***@example.test',
            expiresAt: new Date(Date.now() + 600000).toISOString(),
            retryAfter: 60,
        });
    });
    const revokeSession = (req, res) => {
        const challenge = state.challenges.get(req.body.challengeId);
        if (
            !challenge ||
            challenge.userId !== req.user.id ||
            req.body.code !== CODE ||
            challenge.sessionId !== (req.params.id ?? null)
        )
            return res.status(400).json({ error: 'Неверный или просроченный код.' });
        state.challenges.delete(req.body.challengeId);
        res.json({ ok: true });
        for (const item of [...state.sessions.values()])
            if (
                item.userId === req.user.id &&
                (req.params.id ? item.id === req.params.id : item.id !== req.auth.sessionId)
            )
                revoke(item.id);
    };
    app.post('/playtime/auth/sessions/revoke-others', authorize, revokeSession);
    app.post('/playtime/auth/sessions/:id/revoke', authorize, revokeSession);
    app.post('/playtime/auth/key-transfer/', authorize, (req, res) => {
        const id = uuid(),
            expiresAt = Date.now() + 300000;
        state.transfers.set(id, {
            userId: req.user.id,
            ciphertext: req.body.ciphertext,
            nonce: req.body.nonce,
            expiresAt,
        });
        res.json({ id, expiresAt });
    });
    app.post('/playtime/auth/key-transfer/:id/consume', authorize, (req, res) => {
        const transfer = state.transfers.get(req.params.id);
        if (!transfer || transfer.userId !== req.user.id || transfer.expiresAt < Date.now())
            return res.status(404).json({ error: 'Код истёк или уже использован.' });
        state.transfers.delete(req.params.id);
        res.json({ ciphertext: transfer.ciphertext, nonce: transfer.nonce });
    });
    app.put('/playtime/push/device', authorize, (req, res) => {
        const { provider, token, enabled, mutedChats } = req.body;
        if (
            provider !== 'rustore' ||
            typeof token !== 'string' ||
            token.length < 8 ||
            token.length > 4096 ||
            !/^[\x21-\x7e]+$/.test(token) ||
            typeof enabled !== 'boolean' ||
            !Array.isArray(mutedChats) ||
            mutedChats.length > 500 ||
            mutedChats.some(
                (key) =>
                    typeof key !== 'string' ||
                    !/^(room:[1-9]\d{0,9}|dm:[^\s\u0000-\u001f]{3,15})$/u.test(key),
            )
        ) {
            return res.status(400).json({ error: 'Некорректные настройки уведомлений' });
        }
        state.pushDevices.set(req.auth.sessionId, {
            userId: req.user.id,
            provider,
            token,
            enabled,
            mutedChats: [...new Set(mutedChats)],
        });
        res.json({ registered: true, deliveryReady: false });
    });
    app.delete('/playtime/push/device', authorize, (req, res) => {
        state.pushDevices.delete(req.auth.sessionId);
        res.json({ removed: true });
    });
    app.get('/playtime/peers/blocked', authorize, (req, res) =>
        res.json({ usernames: [...(state.blocks.get(req.user.id) ?? [])] }),
    );
    app.post('/playtime/peers/:username/:action', authorize, (req, res) => {
        const peer = findUser(req.params.username);
        if (!peer || peer.id === req.user.id)
            return res.status(400).json({ error: 'Пользователь не найден' });
        const blocked = state.blocks.get(req.user.id) ?? new Set();
        if (req.params.action === 'report') {
            if ((req.body.reason?.trim().length ?? 0) < 5)
                return res.status(400).json({ error: 'Опишите причину: от 5 до 1000 символов' });
            state.reports.push({
                userId: req.user.id,
                username: peer.username,
                reason: req.body.reason,
            });
        } else if (req.params.action === 'block') {
            blocked.add(peer.username);
            state.friendships = state.friendships.filter(
                (friend) => dmKey(friend.user_id, friend.friend_id) !== dmKey(req.user.id, peer.id),
            );
        } else blocked.delete(peer.username);
        state.blocks.set(req.user.id, blocked);
        res.json({ ok: true });
        emitFriendsUpdated();
    });
    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 12 * 1024 * 1024 + 16 },
    });
    for (const kind of ['voice', 'attachments']) {
        app.post(`/playtime/${kind}/upload`, authorize, upload.single('file'), (req, res) => {
            if (!req.file || req.file.mimetype !== 'application/octet-stream')
                return res.status(400).json({ error: 'Ожидается зашифрованный файл' });
            const key = uuid();
            state.uploads.set(key, { bytes: req.file.buffer, userId: req.user.id, kind });
            res.json(
                kind === 'voice'
                    ? { voiceKey: key }
                    : {
                          attachmentKey: key,
                          mime: 'application/octet-stream',
                          filename: 'attachment.bin',
                          sizeBytes: req.file.size,
                      },
            );
        });
        app.get(`/playtime/${kind}/:key`, authorize, (req, res) => {
            const file = state.uploads.get(req.params.key);
            const message = state.messages.find(
                (item) =>
                    item.voiceStorageKey === req.params.key ||
                    item.attachmentKey === req.params.key,
            );
            const allowed =
                file?.userId === req.user.id ||
                (message &&
                    (message.roomId
                        ? state.rooms
                              .get(message.roomId)
                              ?.members.some((member) => member.id === req.user.id)
                        : [message.senderId, message.receiverId].includes(req.user.id)));
            if (!file || !allowed) return res.status(404).end();
            res.type('application/octet-stream').send(file.bytes);
        });
    }

    io.use((socket, next) => {
        const auth = state.tokens.get(socket.handshake.auth.token);
        if (!auth) return next(new Error('Unauthorized'));
        socket.data.userId = auth.userId;
        socket.data.sessionId = auth.sessionId;
        next();
    });
    io.on('connection', (socket) => {
        socket.use(([event, ...args], next) => {
            const reason = state.socketFailures[event];
            const acknowledgement = args.at(-1);
            if (reason && typeof acknowledgement === 'function') {
                acknowledgement({ err: reason });
                return;
            }
            next();
        });
        const uid = socket.data.userId;
        const user = () => state.users.get(uid);
        socket.join(userKey(uid));
        socket.emit('webrtc:config', { iceServers: [] });
        socket.onAny((event, ...args) =>
            state.captured.push({
                event,
                userId: uid,
                payload: typeof args[0] === 'function' ? null : args[0],
                argumentTypes: args.map((value) => typeof value),
                at: now(),
            }),
        );
        socket.on('auth:refresh', (data) => {
            const auth = state.tokens.get(data.token);
            if (!auth || auth.userId !== uid) socket.disconnect(true);
        });
        socket.on('get:username', (ack) => ack({ username: user().username, userId: uid }));
        socket.on('presence:listByUserId', (ack) => {
            if (typeof ack === 'function') ack([...state.users.keys()]);
        });
        socket.on('presence:list', (ack) => ack(['Nova', 'Orbit']));
        socket.on('ping:measure', (timestamp, ack) => ack(timestamp));
        socket.on('friend:list', (_data, ack) => ack(friendList(uid)));
        socket.on('friend:outgoingList', (_data, ack) =>
            ack(
                friendList(uid)
                    .filter(
                        (friend) => friend.status === 'pending' && friend.direction === 'outgoing',
                    )
                    .map((friend) => friend.friend_username),
            ),
        );
        socket.on('friend:request', (data) => {
            const peer = findUser(data.friendUsername);
            if (!peer)
                return socket.emit('friend:request:error', { err: 'Пользователь не найден' });
            if (peer.id === uid)
                return socket.emit('friend:request:error', {
                    err: 'Вы не можете добавить самого себя',
                });
            if (
                state.friendships.some(
                    (friend) => dmKey(friend.user_id, friend.friend_id) === dmKey(uid, peer.id),
                )
            )
                return socket.emit('friend:request:error', { err: 'Запрос уже существует' });
            state.friendships.push({
                id: Date.now(),
                user_id: uid,
                friend_id: peer.id,
                status: 'pending',
            });
            socket.emit('friend:request:success', {
                username: peer.username,
                msg: 'Запрос успешно отправлен',
            });
            emitFriendsUpdated();
        });
        for (const action of ['accept', 'decline', 'remove'])
            socket.on(`friend:${action}`, (data) => {
                const peer = findUser(data.friendUsername);
                if (!peer) return;
                if (action === 'accept') {
                    const pending = state.friendships.find(
                        (friend) =>
                            friend.user_id === peer.id &&
                            friend.friend_id === uid &&
                            friend.status === 'pending',
                    );
                    if (pending) pending.status = 'accepted';
                } else
                    state.friendships = state.friendships.filter(
                        (friend) =>
                            !(
                                dmKey(friend.user_id, friend.friend_id) === dmKey(uid, peer.id) &&
                                friend.status === (action === 'remove' ? 'accepted' : 'pending')
                            ),
                    );
                emitFriendsUpdated();
            });
        socket.on('profile:get', (data, ack) => {
            const target = data.peerUserId
                ? state.users.get(data.peerUserId)
                : data.username
                ? findUser(data.username)
                : user();
            if (!target || (target.id !== uid && !friends(uid, target.id)))
                return ack({ err: 'Профиль доступен только друзьям' });
            ack({ profile: publicProfile(target, uid) });
        });
        socket.on('profile:update', (data, ack) => {
            for (const field of [
                'status',
                'bio',
                'avatar',
                'profileBanner',
                'profileAvatarEffect',
                'profileBannerEffect',
                'profileBannerSticker',
            ])
                if (Object.hasOwn(data, field)) user()[field] = data[field];
            ack({ success: true });
            io.emit('profile:updated', { username: user().username });
        });
        socket.on('profile:friendsAvatars', (_data, ack) =>
            ack(
                Object.fromEntries(
                    [...state.users.values()].map((item) => [
                        item.username,
                        { avatar: item.avatar, profileAvatarEffect: item.profileAvatarEffect },
                    ]),
                ),
            ),
        );
        socket.on('profile:setDmPublicKey', (data, ack) => {
            if (
                user().dmPublicKey &&
                user().dmPublicKey !== data.publicKey &&
                !data.replaceExisting
            )
                return ack({ err: 'Ключ аккаунта уже изменился на другом устройстве' });
            user().dmPublicKey = data.publicKey;
            seedEncryptedHistory();
            ack({ success: true });
        });
        socket.on('profile:getDmPublicKey', (data, ack) => {
            const target = data.peerUserId
                ? state.users.get(data.peerUserId)
                : findUser(data.username);
            ack(
                target && friends(uid, target.id)
                    ? { publicKey: target.dmPublicKey }
                    : { err: 'Доступно только друзьям' },
            );
        });
        socket.on('room:list', (_data, ack) => {
            const rooms = [...state.rooms.values()]
                .filter((room) => room.members.some((member) => member.id === uid))
                .map(({ id, name, created_by }) => ({ id, name, created_by }));
            if (state.roomListDelayMs) {
                setTimeout(() => ack(rooms), state.roomListDelayMs);
            } else {
                ack(rooms);
            }
        });
        socket.on('room:create', (data, ack) => {
            if (data.name?.length < 3 || data.name?.length > 15)
                return ack({ err: 'Название от 3 до 15 символов' });
            const id = state.nextRoomId++;
            state.rooms.set(id, {
                id,
                name: data.name,
                created_by: uid,
                members: [{ id: uid, username: user().username, role: 'member' }],
                wraps: {},
                pinned: null,
            });
            ack({ success: true, roomId: id, name: data.name });
        });
        socket.on('room:get', (data, ack) => {
            const room = state.rooms.get(data.roomId);
            if (!room?.members.some((member) => member.id === uid))
                return ack({ err: 'Нет доступа к комнате' });
            ack({
                id: room.id,
                name: room.name,
                created_by: room.created_by,
                myId: uid,
                members: room.members,
            });
        });
        socket.on('room:rename', (data, ack) => {
            const room = state.rooms.get(data.roomId);
            if (room?.created_by !== uid)
                return ack({ err: 'Переименовать может только создатель' });
            if (data.name?.length < 3 || data.name?.length > 15)
                return ack({ err: 'Название от 3 до 15 символов' });
            room.name = data.name;
            ack({ success: true, name: room.name });
            emitRoom(room.id, 'room:renamed', { roomId: room.id, name: room.name });
        });
        socket.on('room:addMember', (data, ack) => {
            const room = state.rooms.get(data.roomId),
                target = findUser(data.username) ?? state.users.get(data.userId);
            if (!room || !target || !friends(uid, target.id))
                return ack({ err: 'Добавлять можно только друзей' });
            if (
                room.created_by !== uid &&
                !room.members.some((member) => member.id === uid && member.role === 'moderator')
            )
                return ack({ err: 'Недостаточно прав' });
            if (!room.members.some((member) => member.id === target.id)) {
                rotateRoomKey(room);
                room.members.push({
                    id: target.id,
                    username: target.username,
                    role: 'member',
                    visibleAfterId: state.nextMessageId - 1,
                });
            }
            ack({ success: true });
            emitRoom(room.id, 'room:e2eeNeedWrap', {
                roomId: room.id,
                newUserId: target.id,
                username: target.username,
            });
            emitRoom(room.id, 'room:membersChanged', { roomId: room.id });
        });
        for (const action of [
            'removeMember',
            'setRole',
            'transferOwnership',
            'delete',
            'leaveRoom',
        ])
            socket.on(`room:${action}`, (data, ack) => {
                const room = state.rooms.get(data.roomId);
                if (!room || !room.members.some((member) => member.id === uid))
                    return ack({ err: 'Нет доступа к комнате' });
                if (action !== 'leaveRoom' && room.created_by !== uid)
                    return ack({ err: 'Доступно только владельцу' });
                if (action === 'leaveRoom' && room.created_by === uid)
                    return ack({ err: 'Сначала передайте владение или удалите комнату' });
                if (action === 'delete') {
                    emitRoom(room.id, 'room:removed', { roomId: room.id });
                    state.rooms.delete(room.id);
                } else if (action === 'leaveRoom' || action === 'removeMember') {
                    const targetId = action === 'leaveRoom' ? uid : data.userId;
                    room.members = room.members.filter((member) => member.id !== targetId);
                    rotateRoomKey(room);
                    for (const wraps of Object.values(room.keyHistory ?? {}))
                        delete wraps[targetId];
                    emitUser(targetId, 'room:removed', { roomId: room.id });
                } else if (action === 'setRole') {
                    const target = room.members.find((member) => member.id === data.userId);
                    if (target) target.role = data.role;
                } else room.created_by = data.userId;
                ack({ success: true });
                emitRoom(room.id, 'room:membersChanged', { roomId: room.id });
            });
        socket.on('room:e2eeBundle', (data, ack) => {
            const room = state.rooms.get(data.roomId);
            if (!room?.members.some((member) => member.id === uid))
                return ack({ err: 'Нет доступа к комнате' });
            const currentEpoch = room.epoch ?? 0;
            const epoch = data.epoch ?? currentEpoch;
            if (currentEpoch && data.keyProtocol !== 1) return ack({ err: 'Обновите PlayTime' });
            if (epoch > currentEpoch) return ack({ err: 'Ключ истории недоступен' });
            const wraps = epoch === currentEpoch ? room.wraps : room.keyHistory?.[epoch] ?? {};
            ack({
                epoch,
                currentEpoch,
                members: room.members.map((member) => ({
                    id: member.id,
                    username: member.username,
                    dmPublicKey: state.users.get(member.id)?.dmPublicKey ?? null,
                })),
                wrapCount:
                    epoch === currentEpoch ? Object.keys(wraps).length : Number(!!wraps[uid]),
                myWrap: wraps[uid] ?? null,
            });
        });
        socket.on('room:e2eePutWraps', (data, ack) => {
            const room = state.rooms.get(data.roomId);
            if (!room?.members.some((member) => member.id === uid))
                return ack({ err: 'Нет доступа к комнате' });
            if ((data.epoch ?? 0) !== (room.epoch ?? 0))
                return ack({ err: 'Ключ комнаты изменился' });
            if (
                Object.keys(data.wraps).some(
                    (id) => !room.members.some((member) => member.id === Number(id)),
                )
            )
                return ack({ err: 'Нет доступа' });
            if (Object.keys(data.wraps).some((id) => room.wraps[id]))
                return ack({ err: 'Ключ для этого участника уже есть' });
            for (const [id, ciphertext] of Object.entries(data.wraps))
                room.wraps[id] = {
                    ciphertext,
                    wrapperDmPublicKey: user().dmPublicKey,
                    wrapperUserId: uid,
                };
            ack({ success: true });
        });
        socket.on('message:lastPreviews', (ack) => {
            const dm = {},
                rooms = {},
                dmUnread = {},
                roomUnread = {},
                dmByUserId = {},
                dmUnreadByUserId = {};
            for (const message of state.messages) {
                if (
                    message.roomId != null &&
                    state.rooms.get(message.roomId)?.members.some((member) => member.id === uid)
                ) {
                    rooms[message.roomId] = {
                        from: message.sender_username,
                        content: message.content,
                    };
                    if (!message.read && message.senderId !== uid)
                        roomUnread[message.roomId] = (roomUnread[message.roomId] ?? 0) + 1;
                } else if (
                    message.roomId == null &&
                    [message.senderId, message.receiverId].includes(uid)
                ) {
                    const peerId = message.senderId === uid ? message.receiverId : message.senderId;
                    const name = state.users.get(peerId)?.username;
                    const snippet = {
                        sender_id: message.senderId,
                        from: message.sender_username,
                        content: message.content,
                        is_dm_e2ee: true,
                        senderDmPublicKey: message.senderDmPublicKey,
                        receiverDmPublicKey: message.receiverDmPublicKey,
                    };
                    dm[name] = snippet;
                    dmByUserId[peerId] = snippet;
                    if (!message.read && message.senderId !== uid) {
                        dmUnread[name] = (dmUnread[name] ?? 0) + 1;
                        dmUnreadByUserId[peerId] = (dmUnreadByUserId[peerId] ?? 0) + 1;
                    }
                }
            }
            ack({ dm, rooms, dmUnread, roomUnread, dmByUserId, dmUnreadByUserId });
        });
        socket.on('message:getMessages', (data) => {
            const all = visibleMessages(uid, data).filter(
                (message) => !data.beforeId || message.id < data.beforeId,
            );
            const rows = data.roomId ? all.slice(-50) : all;
            const peer = data.peerUserId
                ? state.users.get(data.peerUserId)
                : findUser(data.username);
            socket.emit('message:getMessages:success', {
                ...data,
                messages: rows.map((message) => toHistory(message, uid)),
                hasMore: data.roomId ? all.length > 50 : false,
                roomReadWatermark: data.roomId
                    ? state.roomReads.get(`${data.roomId}:${uid}`) ?? 0
                    : 0,
                pinnedMessageId: data.roomId
                    ? state.rooms.get(data.roomId)?.pinned
                    : state.pins.get(dmKey(uid, peer?.id)) ?? null,
            });
        });
        socket.on('message:send', (data, ack) => {
            const previous = state.receipts.get(`${uid}:${data.clientMessageId}`);
            if (previous) return ack({ success: true, id: previous, duplicate: true });
            const target = data.peerUserId
                    ? state.users.get(data.peerUserId)
                    : findUser(data.username),
                room = state.rooms.get(data.roomId);
            if (
                room
                    ? !room.members.some((member) => member.id === uid)
                    : !target || !friends(uid, target.id)
            )
                return ack({ err: 'Нет доступа' });
            const content = data.roomId ? data.content : data.message;
            if (
                typeof content !== 'string' ||
                !(data.roomId ? content.startsWith('R2E1:') : content.startsWith('E2E1:'))
            )
                return ack({ err: 'Нужно сквозное шифрование' });
            const reply = state.messages.find((message) => message.id === data.replyToId);
            const message = {
                id: state.nextMessageId++,
                senderId: uid,
                sender_id: uid,
                receiver_id: target?.id,
                receiverId: target?.id,
                sender_username: user().username,
                receiver_username: target?.username,
                from: user().username,
                roomId: data.roomId,
                content,
                created_at: now(),
                read: false,
                is_dm_e2ee: !data.roomId,
                senderDmPublicKey: user().dmPublicKey,
                receiverDmPublicKey: target?.dmPublicKey,
                reply: reply
                    ? {
                          id: reply.id,
                          from: reply.sender_username,
                          preview: '[Защищено сквозным шифрованием]',
                      }
                    : null,
                reactions: [],
                voiceStorageKey: data.voiceKey,
                voiceDurationSec: data.voiceDurationSec,
                attachmentKey: data.attachmentKey,
                attachmentMime: data.attachmentMime,
                attachmentFilename: data.attachmentFilename,
                attachmentSize: data.attachmentSize,
            };
            state.messages.push(message);
            state.receipts.set(`${uid}:${data.clientMessageId}`, message.id);
            if (room) emitRoom(room.id, 'message:receive', message);
            else {
                socket.emit('message:send:success', { ...message, me: true });
                emitUser(target.id, 'message:receive', message);
            }
            ack({ success: true, id: message.id });
        });
        socket.on('message:edit', (data) => {
            const message = state.messages.find(
                (item) => item.id === data.id && item.senderId === uid,
            );
            if (!message) return;
            message.content = data.content;
            message.edited_at = now();
            if (message.roomId) emitRoom(message.roomId, 'message:edited', message);
            else io.emit('message:edited', message);
        });
        socket.on('message:delete', (data) => {
            const message = state.messages.find(
                (item) => item.id === data.id && item.senderId === uid,
            );
            if (!message) return;
            state.messages = state.messages.filter((item) => item.id !== data.id);
            io.emit('message:deleted', { id: data.id, roomId: message.roomId });
        });
        socket.on('message:react', (data) => {
            const message = state.messages.find((item) => item.id === data.messageId);
            if (!message) return;
            const active = !message.reactions.some(
                (reaction) => reaction.emoji === data.emoji && reaction.by === user().username,
            );
            message.reactions = message.reactions.filter(
                (reaction) => !(reaction.emoji === data.emoji && reaction.by === user().username),
            );
            if (active) message.reactions.push({ emoji: data.emoji, by: user().username });
            io.emit('message:reaction', {
                messageId: message.id,
                roomId: message.roomId,
                dmSenderUsername: message.sender_username,
                dmReceiverUsername: message.receiver_username,
                username: user().username,
                emoji: data.emoji,
                active,
            });
        });
        socket.on('message:getRoomReaders', (data, ack) => {
            const room = state.rooms.get(data.roomId);
            const message = state.messages.find(
                (item) => item.id === data.messageId && item.roomId === data.roomId,
            );
            if (!room?.members.some((member) => member.id === uid) || !message) {
                return ack({ err: 'Нет доступа' });
            }
            ack({
                readers: room.members
                    .filter(
                        (member) =>
                            (state.roomReads.get(`${room.id}:${member.id}`) ?? 0) >= message.id,
                    )
                    .map((member) => member.username)
                    .sort(),
            });
        });
        socket.on('message:markRead', (data) => {
            const ids = visibleMessages(uid, data)
                .filter((message) => message.senderId !== uid)
                .map((message) => {
                    message.read = true;
                    return message.id;
                });
            const peer = data.peerUserId
                ? state.users.get(data.peerUserId)
                : findUser(data.username);
            if (peer)
                emitUser(peer.id, 'message:read', {
                    readerUsername: user().username,
                    readerUserId: uid,
                    messageIds: ids,
                });
        });
        socket.on('message:markRoomRead', (data) => {
            const messages = visibleMessages(uid, data);
            state.roomReads.set(
                `${data.roomId}:${uid}`,
                Math.max(0, ...messages.map((message) => message.id)),
            );
            messages.forEach((message) => {
                message.read = true;
            });
        });
        socket.on('dm:setPin', (data) => {
            const peer = data.peerUserId
                ? state.users.get(data.peerUserId)
                : findUser(data.dmUsername);
            if (!peer) return;
            state.pins.set(dmKey(uid, peer.id), data.messageId);
            socket.emit('dm:pinChanged', {
                dmPeer: peer.username,
                peerUserId: peer.id,
                messageId: data.messageId,
            });
        });
        socket.on('room:setPin', (data) => {
            const room = state.rooms.get(data.roomId);
            if (!room) return;
            room.pinned = data.messageId;
            emitRoom(room.id, 'room:pinChanged', data);
        });
        socket.on('dmWallpaper:get', (data, ack) =>
            ack({
                state: state.wallpapers.get(dmKey(uid, findUser(data.peerUsername)?.id)) ?? {
                    kind: 'none',
                },
            }),
        );
        socket.on('dmWallpaper:set', (data, ack) => {
            state.wallpapers.set(dmKey(uid, findUser(data.peerUsername)?.id), data.state);
            ack({});
            socket.emit('dmWallpaper:update', data);
        });
        socket.on('user:changePassword', (data, ack) => {
            if (data.currentPassword !== user().password)
                return ack({ err: 'Неверный текущий пароль' });
            if (data.newPassword?.length < 12)
                return ack({ err: 'Пароль должен содержать от 12 до 50 символов' });
            user().password = data.newPassword;
            ack({ success: true });
            setImmediate(() => {
                for (const session of [...state.sessions.values()])
                    if (session.userId === uid) revoke(session.id);
            });
        });
        socket.on('user:deleteAccount', (data, ack) => {
            if (data.password !== user().password) return ack({ err: 'Неверный пароль' });
            state.users.delete(uid);
            ack({ success: true });
            setImmediate(() => {
                for (const session of [...state.sessions.values()])
                    if (session.userId === uid) revoke(session.id);
            });
        });
        registerFixtureCalls({ socket, io, getState: () => state, findUser, friends });
    });

    return {
        app,
        server,
        io,
        get state() {
            return state;
        },
        async start() {
            await new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(port, host, resolve);
            });
            return `http://${host}:${server.address().port}`;
        },
        async stop() {
            await new Promise((resolve) => io.close(resolve));
            if (server.listening) await new Promise((resolve) => server.close(resolve));
        },
    };
}

module.exports = { createFixtureServer, CODE, PASSWORD };
if (require.main === module) {
    const fixture = createFixtureServer({ port: Number(process.env.PLAYTIME_TEST_PORT ?? 1502) });
    fixture
        .start()
        .then((url) =>
            console.log(
                `PlayTime local E2E fixture: ${url}\nMika: mika@example.test / ${PASSWORD}\nVerification/recovery code: ${CODE}`,
            ),
        );
    for (const signal of ['SIGINT', 'SIGTERM'])
        process.once(signal, () => {
            void fixture.stop().then(() => process.exit(0));
        });
}
