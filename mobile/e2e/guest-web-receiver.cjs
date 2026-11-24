const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createRequire } = require('node:module');
const exec = promisify(execFile);
const root = path.resolve(__dirname, '../..');
const backendRequire = createRequire(path.join(root, 'apps/package.json'));
const databaseRoot = path.join(root, 'apps/database');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = path.resolve(
    process.env.PLAYTIME_GUEST_OUTPUT || 'mobile/e2e/artifacts/guest-web-receiver',
);
const owned = [];
const events = [],
    errors = [];
const configDelayMs = Number(process.env.PLAYTIME_GUEST_CONFIG_DELAY_MS || 0);
const offerDelayMs = Number(process.env.PLAYTIME_GUEST_OFFER_READY_DELAY_MS || 0);
let firstNativeOfferAt = null;
let guestAccountEvidence = null;
let pool, redis, backend, control, io, vite, browser, page, ownerPage, temporary;
const docker = async (...args) => (await exec('docker', args, { timeout: 60000 })).stdout.trim();
const eventually = async (fn, label) => {
    for (let i = 0; i < 150; i++) {
        if (await fn()) return;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('Timed out: ' + label);
};
async function status(targetPage = page) {
    return targetPage.evaluate(async () => ({
        title: document.title,
        captureRequests: window.__captureRequests,
        localAudioTracks: window.__localStreams.flatMap((stream) =>
            stream.getAudioTracks().map((track) => ({
                id: track.id,
                enabled: track.enabled,
                state: track.readyState,
            })),
        ),
        passiveCallVisible: !!document.querySelector('[aria-label="Звонок на другом устройстве"]'),
        guestReminderVisible: document.body.innerText.includes('Вы вошли по нику'),
        videos: [...document.querySelectorAll('video')].map((video) => ({
            width: video.videoWidth,
            height: video.videoHeight,
            paused: video.paused,
            readyState: video.readyState,
            currentTime: video.currentTime,
            visible: !!(video.offsetWidth && video.offsetHeight),
        })),
        historyLoading: !!document.querySelector('[aria-label="Загрузка сообщений"]'),
        tracks: window.__trackEvents,
        connections: await Promise.all(
            window.__connections.map(async (pc) => {
                const stats = await pc.getStats();
                const inbound = [],
                    outbound = [];
                stats.forEach((row) => {
                    if (row.type === 'inbound-rtp')
                        inbound.push({
                            kind: row.kind,
                            bytes: row.bytesReceived,
                            packets: row.packetsReceived,
                            frames: row.framesDecoded,
                            energy: row.totalAudioEnergy,
                        });
                    if (row.type === 'outbound-rtp')
                        outbound.push({
                            kind: row.kind,
                            bytes: row.bytesSent,
                            packets: row.packetsSent,
                        });
                });
                return {
                    connection: pc.connectionState,
                    signaling: pc.signalingState,
                    inbound,
                    outbound,
                    remoteSdp: pc.remoteDescription?.sdp,
                    localSdp: pc.localDescription?.sdp,
                };
            }),
        ),
    }));
}
async function observedContext() {
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        permissions: ['microphone'],
    });
    await context.addInitScript(() => {
        window.__captureRequests = 0;
        window.__localStreams = [];
        const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async (constraints) => {
            window.__captureRequests++;
            const stream = await capture(constraints);
            window.__localStreams.push(stream);
            return stream;
        };
        window.__connections = [];
        window.__trackEvents = [];
        const Native = window.RTCPeerConnection;
        window.RTCPeerConnection = new Proxy(Native, {
            construct(target, args) {
                const pc = Reflect.construct(target, [{ ...args[0], iceTransportPolicy: 'relay' }]);
                window.__connections.push(pc);
                pc.addEventListener('track', (event) => {
                    const row = {
                        kind: event.track.kind,
                        id: event.track.id,
                        muted: event.track.muted,
                        unmuted: false,
                    };
                    window.__trackEvents.push(row);
                    event.track.addEventListener('unmute', () => {
                        row.unmuted = true;
                    });
                });
                return pc;
            },
        });
    });
    return context;
}
async function cleanup() {
    await browser?.close();
    if (io) await new Promise((resolve) => io.close(resolve));
    backend?.close();
    control?.close();
    await vite?.close();
    await Promise.allSettled([pool?.end(), redis?.quit()]);
    await Promise.allSettled(owned.map((id) => docker('rm', '-f', id)));
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
}
async function main() {
    await fs.mkdir(output, { recursive: true });
    await fs.chmod(output, 0o700);
    const assertLocal = await docker(
        'context',
        'inspect',
        '--format',
        '{{.Endpoints.docker.Host}}',
    );
    if (!assertLocal.startsWith('unix://')) throw new Error('Local Docker only');
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'playtime-native-guest-'));
    const suffix = crypto.randomBytes(5).toString('hex');
    const password = crypto.randomBytes(24).toString('hex');
    for (const [service, image, port, args] of [
        [
            'pg',
            'postgres:15-alpine',
            '5432',
            [
                '-e',
                'POSTGRES_USER=playtime_test',
                '-e',
                'POSTGRES_DB=playtime_test',
                '-e',
                `POSTGRES_PASSWORD=${password}`,
            ],
        ],
        ['redis', 'redis:7-alpine', '6379', []],
        ['turn', 'coturn/coturn:4.6.3', '3478', []],
    ]) {
        const command =
            service === 'redis'
                ? ['redis-server', '--save', '', '--appendonly', 'no', '--requirepass', password]
                : service === 'turn'
                ? [
                      '-n',
                      '--listening-port=3478',
                      '--fingerprint',
                      '--lt-cred-mech',
                      `--user=qa:${password}`,
                      '--realm=playtime.test',
                      '--no-tls',
                      '--no-dtls',
                      '--no-cli',
                      '--log-file=stdout',
                      '--allow-loopback-peers',
                  ]
                : [];
        owned.push(
            await docker(
                'run',
                '--rm',
                '-d',
                '--name',
                `playtime-native-guest-${service}-${suffix}`,
                '--label',
                'playtime.qa=native-guest',
                '-p',
                `127.0.0.1::${port}${service === 'turn' ? '/tcp' : ''}`,
                ...args,
                image,
                ...command,
            ),
        );
    }
    const port = async (index, target) =>
        Number(
            await docker(
                'inspect',
                '--format',
                `{{(index (index .NetworkSettings.Ports "${target}/tcp") 0).HostPort}}`,
                owned[index],
            ),
        );
    const [pgPort, redisPort, turnPort] = await Promise.all([
        port(0, 5432),
        port(1, 6379),
        port(2, 3478),
    ]);
    await fs.writeFile(path.join(temporary, 'empty.env'), '');
    Object.assign(process.env, {
        NODE_ENV: 'test',
        DOTENV_CONFIG_PATH: path.join(temporary, 'empty.env'),
        PG_HOST: '127.0.0.1',
        PG_PORT: String(pgPort),
        PG_USER: 'playtime_test',
        PG_DATABASE: 'playtime_test',
        PG_PASSWORD: password,
        REDIS_URL: `redis://:${password}@127.0.0.1:${redisPort}/0`,
        JWT_SECRET_ENV: 'isolated-native-guest-test-secret-not-production',
        CORS_ORIGIN: 'http://127.0.0.1:4176',
        WEBRTC_STUN_URLS: 'stun:127.0.0.1:9',
        WEBRTC_TURN_URL: `turn:127.0.0.1:${turnPort}?transport=tcp`,
        WEBRTC_TURN_USERNAME: 'qa',
        WEBRTC_TURN_CREDENTIAL: password,
    });
    for (const key of [
        'RUSTORE_PUSH_PROJECT_ID',
        'RUSTORE_PUSH_SERVICE_TOKEN',
        'WEBRTC_TURN_HOST',
        'WEBRTC_TURN_SECRET',
        'SMTP_HOST',
        'SMTP_USER',
        'SMTP_PASSWORD',
        'YOOKASSA_SECRET_KEY',
    ])
        delete process.env[key];
    require('tsx/cjs');
    ({ pool, redis } = require('../../apps/shared/config.ts'));
    redis.on('error', () => {});
    await eventually(async () => {
        try {
            await pool.query('SELECT 1');
            return (await redis.ping()) === 'PONG';
        } catch {
            return false;
        }
    }, 'database');
    await pool.query(await fs.readFile(path.join(databaseRoot, 'schema.sql'), 'utf8'));
    const migrations = path.join(databaseRoot, 'migrations');
    for (const file of (await fs.readdir(migrations))
        .filter((file) => file.endsWith('.sql'))
        .sort()) {
        await pool.query(await fs.readFile(path.join(migrations, file), 'utf8'));
    }
    const hash = await backendRequire('bcrypt').hash('PlayTime-test-123', 12);
    const mika = (
        await pool.query(
            "INSERT INTO users(username,email,password_hash,email_verified_at) VALUES('Mika','mika@example.test',$1,NOW()) RETURNING id",
            [hash],
        )
    ).rows[0];
    const { createLegacyApp } = require('../../apps/gateway/legacy/http.ts');
    const { authSocket } = require('../../apps/gateway/middlewares/authMiddleware.ts');
    const { attachSocketConnection } = require('../../apps/gateway/legacy/socket.ts');
    const presence = require('../../apps/gateway/presence.ts');
    const { registerCallEndpoint } = require('../../apps/room-api/socket/directCall/ownership.ts');
    const { callStore } = require('../../apps/room-api/socket/directCall/redisService.ts');
    const app = createLegacyApp();
    backend = http.createServer(app);
    io = new (backendRequire('socket.io').Server)(backend, {
        path: '/playtime/socket.io',
        cors: { origin: true, credentials: true },
    });
    app.set('io', io);
    io.use(authSocket);
    io.on('connection', (socket) => {
        const user = socket.user;
        const nativeSocket =
            socket.handshake.headers.origin === 'http://10.0.2.2:1516' &&
            socket.handshake.headers['user-agent']?.startsWith('okhttp/');
        events.push({
            userId: user.id,
            event: 'qa:client',
            nativeSocket,
            userAgent: socket.handshake.headers['user-agent'],
            origin: socket.handshake.headers.origin,
        });
        presence.onConnect(socket);
        socket.join(String(user.id));
        if (socket.handshake.auth.peerIdentityProtocol === 1) {
            socket.join(`peer-identity-v1:${user.id}`);
        }
        socket.use(([event, data], next) => {
            if (
                offerDelayMs > 0 &&
                user.id === mika.id &&
                event === 'webrtc:signal' &&
                data?.type === 'offer'
            ) {
                if (firstNativeOfferAt === null) firstNativeOfferAt = Date.now();
                const elapsedMs = Date.now() - firstNativeOfferAt;
                if (elapsedMs < offerDelayMs) {
                    events.push({
                        userId: user.id,
                        event,
                        type: data.type,
                        fault: 'receiver-unavailable',
                        elapsedMs,
                        sdpSha256: crypto
                            .createHash('sha256')
                            .update(data.payload?.sdp || '')
                            .digest('hex'),
                    });
                    return;
                }
                events.push({
                    userId: user.id,
                    event,
                    type: data.type,
                    fault: 'receiver-ready',
                    elapsedMs,
                });
            }
            next();
        });
        const emit = socket.emit.bind(socket);
        socket.emit = (event, ...args) => {
            if (event.startsWith('message:getMessages:')) {
                events.push({
                    userId: user.id,
                    event,
                    direction: 'server',
                    requestId: args[0]?.requestId,
                    messageCount: args[0]?.messages?.length,
                    error: args[0]?.err,
                });
            }
            if (event === 'webrtc:config' && user.id === mika.id && nativeSocket)
                args[0] = {
                    ...args[0],
                    iceServers: args[0].iceServers.map((server) => ({
                        ...server,
                        urls: Array.isArray(server.urls)
                            ? server.urls.map((url) => url.replace('127.0.0.1', '10.0.2.2'))
                            : server.urls.replace('127.0.0.1', '10.0.2.2'),
                    })),
                };
            if (event === 'webrtc:config' && user.id !== mika.id && configDelayMs > 0) {
                events.push({
                    userId: user.id,
                    event,
                    direction: 'server',
                    delayMs: configDelayMs,
                });
                setTimeout(() => {
                    if (socket.connected) emit(event, ...args);
                }, configDelayMs);
                return socket;
            }
            return emit(event, ...args);
        };
        socket.onAny((event, data) => {
            if (
                event.startsWith('call:') ||
                event === 'webrtc:signal' ||
                event === 'webrtc:screen:state' ||
                event === 'message:getMessages'
            )
                events.push({ userId: user.id, event, data });
        });
        void registerCallEndpoint(socket, user.id).catch(() => socket.disconnect(true));
        attachSocketConnection(io, socket, user);
        socket.on('get:username', (callback) => {
            if (typeof callback === 'function')
                callback({ username: user.username, userId: user.id });
        });
        socket.on('disconnect', () => {
            void Promise.resolve(socket.data.callEndpointReady).then(() =>
                callStore.disconnectEndpoint(socket.id),
            );
            presence.onDisconnect(socket);
        });
    });
    await new Promise((resolve) => backend.listen(1516, '127.0.0.1', resolve));
    const { createServer } = await import('vite');
    vite = await createServer({
        configFile: path.join(root, 'vite.web.config.mts'),
        server: {
            proxy: {
                '^/playtime/(auth|subscription|peers|attachments|voice|releases|downloads|socket\\.io)':
                    { target: 'http://127.0.0.1:1516', changeOrigin: true, ws: true },
            },
        },
    });
    await vite.listen();
    browser = await chromium.launch({
        headless: true,
        executablePath:
            process.env.WEB_BROWSER_PATH ||
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
            '--mute-audio',
        ],
    });
    const context = await observedContext();
    page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto('http://127.0.0.1:4176/playtime/app/#/guest');
    await page.getByLabel('Никнейм', { exact: true }).fill('BrowserQA');
    await page.getByRole('button', { name: 'Начать общение', exact: true }).click();
    await page.waitForURL('**/#/content');
    const guest = (await pool.query("SELECT id,is_guest FROM users WHERE username='BrowserQA'"))
        .rows[0];
    if (!guest?.is_guest) throw new Error('Actual guest auth did not create a guest');
    guestAccountEvidence = {
        userId: guest.id,
        isGuest: guest.is_guest,
        createdThroughGuestUi: true,
    };
    await pool.query("INSERT INTO friendships(user_id,friend_id,status) VALUES($1,$2,'accepted')", [
        mika.id,
        guest.id,
    ]);
    io.emit('friend:list:updated');
    control = http.createServer(async (req, res) => {
        try {
            if (req.url === '/shutdown') {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ stopping: true }));
                setImmediate(() => {
                    void cleanup().finally(() => process.exit());
                });
                return;
            }
            if (req.url === '/open-owner') {
                const ownerContext = await observedContext();
                ownerPage = await ownerContext.newPage();
                ownerPage.on('pageerror', (error) => errors.push('owner: ' + error.message));
                ownerPage.on('console', (message) => {
                    if (message.type() === 'error') errors.push('owner: ' + message.text());
                });
                await ownerPage.goto('http://127.0.0.1:4176/playtime/app/#/login');
                await ownerPage.getByLabel('Почта', { exact: true }).fill('mika@example.test');
                await ownerPage.getByLabel('Пароль', { exact: true }).fill('PlayTime-test-123');
                await ownerPage.getByRole('button', { name: 'Войти', exact: true }).click();
                await ownerPage.waitForURL('**/#/content');
                await ownerPage
                    .getByRole('status', { name: 'Звонок на другом устройстве' })
                    .waitFor();
            }
            if (req.url === '/claim-owner') {
                await ownerPage
                    .getByRole('button', { name: 'Продолжить звонок здесь', exact: true })
                    .click();
            }
            if (req.url === '/owner-screenshot') {
                res.setHeader('Content-Type', 'image/png');
                return res.end(await ownerPage.screenshot());
            }
            if (req.url === '/answer') {
                await page.getByRole('button', { name: 'Принять', exact: true }).click();
            }
            if (req.url === '/screenshot') {
                res.setHeader('Content-Type', 'image/png');
                return res.end(await page.screenshot());
            }
            const current = await callStore.current(mika.id);
            const state = {
                ...(await status()),
                secondDevice: ownerPage ? await status(ownerPage) : null,
                backendCall: current.room
                    ? {
                          roomId: current.roomId,
                          status: current.room.status,
                          revision: current.room.revision,
                          owners: Object.entries(current.room.owners || {}).map(
                              ([userId, owner]) => ({
                                  userId: Number(userId),
                                  socketId: owner.socketId,
                                  ownershipRevision: owner.ownershipRevision,
                                  modern: !!owner.modern,
                              }),
                          ),
                      }
                    : null,
                events,
                errors,
                guestAccountCreatedThroughUi: true,
                realBackend: true,
                guestAccount: guestAccountEvidence,
            };
            await fs.writeFile(path.join(output, 'state.json'), JSON.stringify(state, null, 4), {
                mode: 0o600,
            });
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(state));
        } catch (error) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(error) }));
        }
    });
    await new Promise((resolve) => control.listen(1517, '127.0.0.1', resolve));
    console.log(
        'READY isolated actual guest web receiver: control localhost1517, backend1516, web4176',
    );
}
process.on('SIGINT', () => cleanup().finally(() => process.exit()));
process.on('SIGTERM', () => cleanup().finally(() => process.exit()));
main().catch(async (error) => {
    console.error(error.message);
    if (page) {
        await page.screenshot({ path: path.join(output, 'startup-failure.png') }).catch(() => {});
        await fs.writeFile(
            path.join(output, 'startup-failure.json'),
            JSON.stringify(
                {
                    error: error.message,
                    errors,
                    url: page.url(),
                    text: await page
                        .locator('body')
                        .innerText()
                        .catch(() => ''),
                },
                null,
                4,
            ),
        );
    }
    await cleanup();
    process.exit(1);
});
