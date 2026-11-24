const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const crypto = require("node:crypto")
const { promisify } = require("node:util")
const { execFile } = require("node:child_process")
const { createRequire } = require("node:module")
const { once } = require("node:events")
const net = require("node:net")
const exec = promisify(execFile)
const root = path.resolve(__dirname, "../..")
const backendRequire = createRequire(path.join(root, "apps/package.json"))
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
const output = process.env.CALL_HANDOFF_OUTPUT || path.join(root, "artifacts/direct-call-handoff")
const containers = [],
    pages = [],
    errors = [],
    external = [],
    snapshots = [],
    events = []
const sourceHashes = {}
const localEmojiFixtures = []
const useLocalRelay = process.env.CALL_HANDOFF_DIRECT !== "1"
const configDelayMs = Number(process.env.CALL_HANDOFF_CONFIG_DELAY_MS ?? 750)
assert.ok(Number.isInteger(configDelayMs) && configDelayMs >= 0 && configDelayMs <= 2000)
const delayedConfigurations = []
const deviceSessions = new Map()
let currentCalleeId
let pool, redis, vite, io, browser, temporary
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function eventually(check, label, timeout = 25000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
        if (await check()) return
        await wait(100)
    }
    throw new Error("Timed out: " + label)
}
function wav() {
    const sampleRate = 48000,
        seconds = 4,
        samples = sampleRate * seconds,
        result = Buffer.alloc(44 + samples * 2)
    result.write("RIFF")
    result.writeUInt32LE(result.length - 8, 4)
    result.write("WAVEfmt ", 8)
    result.writeUInt32LE(16, 16)
    result.writeUInt16LE(1, 20)
    result.writeUInt16LE(1, 22)
    result.writeUInt32LE(sampleRate, 24)
    result.writeUInt32LE(sampleRate * 2, 28)
    result.writeUInt16LE(2, 32)
    result.writeUInt16LE(16, 34)
    result.write("data", 36)
    result.writeUInt32LE(samples * 2, 40)
    for (let index = 0; index < samples; index++)
        result.writeInt16LE(
            Math.round(Math.sin((index / sampleRate) * Math.PI * 2 * (240 + (index % 48000) / 240)) * 10000),
            44 + index * 2
        )
    return result
}
async function stats(page) {
    return page.evaluate(async () =>
        Promise.all(
            window.__mediaConnections.map(async (pc) => {
                const reports = await pc.getStats(),
                    inbound = [],
                    outbound = [],
                    candidates = [],
                    pairs = [],
                    selectedPairs = []
                reports.forEach((report) => {
                    if (report.type === "inbound-rtp")
                        inbound.push({
                            kind: report.kind,
                            packets: report.packetsReceived || 0,
                            bytes: report.bytesReceived || 0,
                            energy: report.totalAudioEnergy || 0,
                            frames: report.framesDecoded || 0
                        })
                    if (report.type === "outbound-rtp")
                        outbound.push({
                            kind: report.kind,
                            packets: report.packetsSent || 0,
                            bytes: report.bytesSent || 0,
                            frames: report.framesEncoded || 0
                        })
                    if (["local-candidate", "remote-candidate"].includes(report.type))
                        candidates.push({
                            side: report.type,
                            type: report.candidateType,
                            protocol: report.protocol,
                            relayProtocol: report.relayProtocol,
                            addressKind: report.address?.endsWith(".local")
                                ? "mdns"
                                : report.address?.includes(":")
                                  ? "ipv6"
                                  : "ipv4"
                        })
                    if (report.type === "candidate-pair")
                        pairs.push({
                            state: report.state,
                            nominated: report.nominated,
                            requestsSent: report.requestsSent,
                            responsesReceived: report.responsesReceived
                        })
                    if (report.type === "transport" && report.selectedCandidatePairId) {
                        const pair = reports.get(report.selectedCandidatePairId),
                            local = reports.get(pair?.localCandidateId),
                            remote = reports.get(pair?.remoteCandidateId)
                        if (pair)
                            selectedPairs.push({
                                state: pair.state,
                                nominated: pair.nominated,
                                localType: local?.candidateType,
                                remoteType: remote?.candidateType,
                                relayProtocol: local?.relayProtocol
                            })
                    }
                })
                return {
                    connection: pc.connectionState,
                    ice: pc.iceConnectionState,
                    inbound,
                    outbound,
                    candidates,
                    pairs,
                    selectedPairs,
                    senders: pc.getSenders().map((sender) => ({
                        kind: sender.track?.kind,
                        enabled: sender.track?.enabled,
                        state: sender.track?.readyState
                    }))
                }
            })
        )
    )
}
async function observe(page) {
    const list = page.getByRole("list", { name: "Участники звонка", exact: true })
    return {
        participants: await list.getByRole("listitem").allTextContents(),
        state: await page.evaluate(() => ({
            states: window.callHandoffQa.states,
            activeCall: window.callHandoffQa.activeCall,
            captures: window.__captureRequests,
            audioContexts: window.__audioContextRequests,
            connections: window.__mediaConnections.length
        })),
        rtp: await stats(page)
    }
}
async function capture(stage) {
    const observations = await Promise.all(pages.map(observe))
    snapshots.push({ stage, observations })
    for (const [index, page] of pages.entries()) {
        await page.screenshot({ path: path.join(output, `${stage}-user${index + 1}.png`), fullPage: true })
    }
    return observations
}
async function current(page) {
    return page.evaluate(
        () =>
            new Promise((resolve) =>
                window.callHandoffQa.socket
                    .timeout(8000)
                    .emit("call:current", (error, response) => resolve(error ? { err: error.message } : response))
            )
    )
}
async function waitForAudio(activePages, label) {
    await eventually(
        async () =>
            (await Promise.all(activePages.map(stats))).every((connections) =>
                connections.some(
                    (pc) =>
                        pc.connection === "connected" &&
                        pc.inbound.some((track) => track.kind === "audio" && track.packets > 20 && track.energy > 0)
                )
            ),
        label
    )
}
async function runHandoff(base) {
    const [phone, peer, desktop] = pages
    await phone.getByRole("button", { name: "Позвонить mira", exact: true }).click()
    await peer.getByRole("dialog", { name: "Входящий звонок" }).waitFor()
    await peer.getByRole("button", { name: "Принять", exact: true }).click()
    await waitForAudio([phone, peer], "initial phone to peer bidirectional RTP")
    await desktop.goto(`${base}/__call-handoff?user=1&device=desktop`)
    await desktop.getByText("Звонок на другом устройстве", { exact: true }).waitFor()
    await desktop.waitForTimeout(1500)
    const passive = await desktop.evaluate(() => ({
        captures: window.__captureRequests,
        audioContexts: window.__audioContextRequests,
        peers: window.__mediaConnections.length
    }))
    assert.deepEqual(passive, { captures: 0, audioContexts: 0, peers: 0 }, "Passive device creates no media resources")
    await desktop.getByRole("complementary", { name: "Список чатов" }).getByText("mira", { exact: true }).click()
    await desktop.getByTitle("Позвонить", { exact: true }).waitFor()
    await desktop.getByTitle("Позвонить", { exact: true }).click()
    await desktop.waitForTimeout(500)
    const afterPhoneIcon = await desktop.evaluate(() => ({
        captures: window.__captureRequests,
        audioContexts: window.__audioContextRequests,
        peers: window.__mediaConnections.length,
        activeCall: window.callHandoffQa.activeCall
    }))
    assert.deepEqual(
        afterPhoneIcon,
        { captures: 0, audioContexts: 0, peers: 0, activeCall: null },
        "Actual chat phone icon cannot bypass passive endpoint ownership"
    )
    await desktop.getByText("Звонок на другом устройстве", { exact: true }).waitFor()
    const initial = await current(phone)
    assert.equal(initial.state.media.active, true)
    assert.equal((await current(desktop)).state.media.active, false)
    await capture("passive-desktop")
    await desktop.getByRole("button", { name: "Продолжить звонок здесь", exact: true }).click()
    await waitForAudio([desktop, peer], "claimed desktop to unchanged peer bidirectional RTP")
    await eventually(
        async () => (await stats(phone)).every((pc) => pc.connection === "closed"),
        "old phone closes all peer connections"
    )
    const claimed = await current(desktop)
    assert.equal(claimed.state.media.active, true)
    assert(claimed.state.media.ownershipRevision > initial.state.media.ownershipRevision)
    assert.equal((await current(phone)).state.media.active, false)
    await phone.evaluate(
        ({ roomId, ownershipRevision }) => {
            window.callHandoffQa.socket.emit("call:end", { roomId, ownershipRevision })
        },
        { roomId: initial.state.roomId, ownershipRevision: initial.state.media.ownershipRevision }
    )
    await phone.waitForTimeout(300)
    assert.equal((await current(peer)).state.roomId, initial.state.roomId, "Stale owner cannot end transferred call")
    await phone.evaluate(() => window.callHandoffQa.socket.disconnect())
    await peer.waitForTimeout(1000)
    assert.equal((await current(peer)).state.roomId, initial.state.roomId, "Old endpoint disconnect cannot end call")
    await waitForAudio([desktop, peer], "audio survives old-owner end and disconnect")
    assert.equal(
        await peer.evaluate(() => window.__captureRequests),
        1,
        "Peer microphone survives transfer without recapture"
    )
    const peerConnections = await stats(peer)
    assert(
        peerConnections.some((pc) => pc.connection === "closed"),
        "Replaced endpoint closes peer old connection"
    )
    await desktop.evaluate(() => window.callHandoffQa.socket.disconnect())
    await desktop.waitForTimeout(200)
    await desktop.evaluate(() => window.callHandoffQa.socket.connect())
    await desktop
        .getByTestId("signaling")
        .filter({ hasText: /^connected$/ })
        .waitFor()
    const reattached = await current(desktop)
    assert.equal(reattached.state.media.active, true, "Same endpoint reconnect retains ownership")
    assert.equal(reattached.state.media.ownershipRevision, claimed.state.media.ownershipRevision)
    await waitForAudio([desktop, peer], "active endpoint reconnect preserves bidirectional RTP")
    await capture("desktop-claimed")
    await phone.evaluate(() => window.callHandoffQa.socket.connect())
    await phone
        .getByTestId("signaling")
        .filter({ hasText: /^connected$/ })
        .waitFor()
    await phone.getByRole("button", { name: "Продолжить звонок здесь", exact: true }).click()
    await waitForAudio([phone, peer], "explicit transfer back to reconnected phone")
    assert.equal((await current(desktop)).state.media.active, false)
    assert.equal(await peer.evaluate(() => window.__captureRequests), 1, "Two transfers reuse peer microphone")
    await capture("phone-reclaimed")
}
;(async () => {
    await fs.mkdir(output, { recursive: true })
    const additionalSources = [
        "apps/gateway/legacy.ts",
        "apps/gateway/legacy/socketAuth.ts",
        "apps/frontend/src/components/Chat/Chat.tsx",
        "apps/frontend/src/components/ModalWindow/ModalWindow.tsx",
        "apps/frontend/src/pages/Content/ContentPage.tsx",
        "apps/frontend/src/features/chat/components/ChatHeader.tsx"
    ]
    for (const directory of [
        "apps/room-api/socket/directCall",
        "apps/frontend/src/features/call",
        "apps/frontend/src/pages/Talk/Remake/hooks"
    ]) {
        for (const file of await fs.readdir(path.join(root, directory), { recursive: true })) {
            if (/\.(ts|tsx|css)$/.test(file) && !/\.test\./.test(file))
                additionalSources.push(path.posix.join(directory, file))
        }
    }
    for (const file of [
        ...additionalSources,
        "apps/frontend/src/pages/MainLayout/MainLayoutPage.tsx",
        "apps/frontend/src/utils/IncomingCallHandler.tsx",
        "apps/frontend/src/utils/directCallState.ts",
        "apps/frontend/src/pages/Talk/Remake/Talk.tsx",
        "apps/frontend/src/pages/Talk/Remake/hooks/useCallAudio.ts",
        "apps/frontend/src/webrtc/voiceMesh.ts",
        "apps/room-api/socket/directCall/index.ts",
        "apps/room-api/socket/directCall/ownership.ts",
        "apps/room-api/socket/directCall/callStore.ts",
        "scripts/fixtures/direct-call-handoff-peer.tsx",
        "scripts/tests/direct-call-handoff-ui.cjs"
    ]) {
        const source =
            file === "apps/frontend/src/pages/MainLayout/MainLayoutPage.tsx" && process.env.CALL_HANDOFF_LAYOUT_SOURCE
                ? process.env.CALL_HANDOFF_LAYOUT_SOURCE
                : path.join(root, file)
        sourceHashes[file] = crypto
            .createHash("sha256")
            .update(await fs.readFile(source))
            .digest("hex")
    }
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), "playtime-call-handoff-"))
    const docker = async (...args) => (await exec("docker", args, { timeout: 60000 })).stdout.trim()
    assert.match(
        await docker("context", "inspect", "--format", "{{.Endpoints.docker.Host}}"),
        /^unix:\/\//,
        "Only local Docker is allowed"
    )
    const suffix = crypto.randomBytes(6).toString("hex"),
        password = crypto.randomBytes(24).toString("hex")
    containers.push(
        await docker(
            "run",
            "--rm",
            "-d",
            "--name",
            `playtime-call-pg-${suffix}`,
            "--label",
            "playtime.qa=call-handoff",
            "-p",
            "127.0.0.1::5432",
            "-e",
            "POSTGRES_USER=playtime_test",
            "-e",
            "POSTGRES_DB=playtime_test",
            "-e",
            `POSTGRES_PASSWORD=${password}`,
            "postgres:15-alpine"
        )
    )
    containers.push(
        await docker(
            "run",
            "--rm",
            "-d",
            "--name",
            `playtime-call-redis-${suffix}`,
            "--label",
            "playtime.qa=call-handoff",
            "-p",
            "127.0.0.1::6379",
            "redis:7-alpine",
            "redis-server",
            "--save",
            "",
            "--appendonly",
            "no",
            "--requirepass",
            password
        )
    )
    const port = async (id, target) =>
        Number(
            await docker(
                "inspect",
                "--format",
                `{{(index (index .NetworkSettings.Ports "${target}/tcp") 0).HostPort}}`,
                id
            )
        )
    const [pgPort, redisPort] = await Promise.all([port(containers[0], 5432), port(containers[1], 6379)])
    await fs.writeFile(path.join(temporary, "empty.env"), "")
    Object.assign(process.env, {
        NODE_ENV: "test",
        DOTENV_CONFIG_PATH: path.join(temporary, "empty.env"),
        PG_HOST: "127.0.0.1",
        PG_PORT: String(pgPort),
        PG_USER: "playtime_test",
        PG_DATABASE: "playtime_test",
        PG_PASSWORD: password,
        REDIS_URL: `redis://:${password}@127.0.0.1:${redisPort}/0`,
        JWT_SECRET_ENV: "isolated-call-handoff-test-secret-not-production",
        WEBRTC_STUN_URLS: "stun:127.0.0.1:9"
    })
    for (const key of [
        "RUSTORE_PUSH_PROJECT_ID",
        "RUSTORE_PUSH_SERVICE_TOKEN",
        "WEBRTC_TURN_HOST",
        "WEBRTC_TURN_URL",
        "WEBRTC_TURN_SECRET"
    ])
        delete process.env[key]
    if (useLocalRelay) {
        const listener = net.createServer()
        listener.listen(0, "127.0.0.1")
        await once(listener, "listening")
        const turnPort = listener.address().port
        await new Promise((resolve) => listener.close(resolve))
        containers.push(
            await docker(
                "run",
                "--rm",
                "-d",
                "--name",
                `playtime-call-turn-${suffix}`,
                "--label",
                "playtime.qa=call-handoff",
                "-p",
                `127.0.0.1:${turnPort}:3478/tcp`,
                "coturn/coturn:4.6.3",
                "-n",
                "--listening-port=3478",
                "--fingerprint",
                "--lt-cred-mech",
                `--user=qa:${password}`,
                "--realm=playtime.test",
                "--no-tls",
                "--no-dtls",
                "--no-cli",
                "--log-file=stdout",
                "--min-port=49160",
                "--max-port=49180",
                "--allow-loopback-peers"
            )
        )
        process.env.WEBRTC_TURN_URL = `turn:127.0.0.1:${turnPort}?transport=tcp`
        process.env.WEBRTC_TURN_USERNAME = "qa"
        process.env.WEBRTC_TURN_CREDENTIAL = password
    }
    require("tsx/cjs")
    ;({ pool, redis } = require("../../apps/shared/config.ts"))
    redis.on("error", () => {})
    await eventually(async () => {
        try {
            await pool.query("SELECT 1")
            return (await redis.ping()) === "PONG"
        } catch {
            return false
        }
    }, "isolated database readiness")
    await pool.query(await fs.readFile(path.join(root, "apps/database/schema.sql"), "utf8"))
    for (const name of (await fs.readdir(path.join(root, "apps/database/migrations")))
        .filter((name) => name.endsWith(".sql"))
        .sort())
        await pool.query(await fs.readFile(path.join(root, "apps/database/migrations", name), "utf8"))
    await pool.query(
        "INSERT INTO users(id,username,email,password_hash,email_verified_at) VALUES(1,'alex','alex@example.test','test-only',NOW()),(2,'mira','mira@example.test','test-only',NOW())"
    )
    await pool.query("INSERT INTO friendships(user_id,friend_id,status) VALUES(1,2,'accepted')")
    const { issueRefreshToken, signUserAccessToken } = require("../../apps/auth-api/auth/index.ts")
    for (const [device, id] of [
        ["phone", 1],
        ["peer", 2],
        ["desktop", 1]
    ]) {
        const session = { id, username: id === 1 ? "alex" : "mira", sessionVersion: 0 }
        await issueRefreshToken(session, { deviceName: "QA " + device })
        deviceSessions.set(device, { token: signUserAccessToken(session), userId: id })
    }
    const { createServer } = await import("vite"),
        { default: react } = await import("@vitejs/plugin-react")
    const baseline = process.env.CALL_HANDOFF_LAYOUT_SOURCE
    vite = await createServer({
        root,
        publicDir: path.join(root, "apps/frontend/public"),
        optimizeDeps: { entries: ["scripts/fixtures/direct-call-handoff-peer.tsx"] },
        configFile: false,
        define: {
            "process.env.REACT_APP_WEB_BUILD": '"true"',
            "process.env.REACT_APP_API_BASE": '"/playtime"',
            "process.env.REACT_APP_SOCKET_URL": '""'
        },
        server: {
            port: Number(process.env.CALL_HANDOFF_PORT || 4197),
            host: "127.0.0.1",
            strictPort: true,
            hmr: false,
            watch: null
        },
        plugins: [
            ...(baseline
                ? [
                      {
                          name: "preserved-negative-control",
                          enforce: "pre",
                          async load(id) {
                              if (id === path.join(root, "apps/frontend/src/pages/MainLayout/MainLayoutPage.tsx"))
                                  return fs.readFile(baseline, "utf8")
                          }
                      }
                  ]
                : []),
            react(),
            {
                name: "call-handoff-fixture",
                configureServer(server) {
                    server.middlewares.use("/__call-handoff", async (_request, response) => {
                        response.setHeader("Content-Type", "text/html")
                        response.end(
                            await server.transformIndexHtml(
                                "/__call-handoff",
                                '<!doctype html><html lang="ru"><head><link rel="stylesheet" href="/scrollbars.css"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/direct-call-handoff-peer.tsx"></script></body></html>'
                            )
                        )
                    })
                }
            }
        ]
    })
    const { Server } = backendRequire("socket.io")
    const { attachSocketConnection } = require("../../apps/gateway/legacy/socket.ts")
    io = new Server(vite.httpServer, { path: "/qa-call-socket" })
    const { authSocket } = require("../../apps/gateway/legacy/socketAuth.ts")
    const { accessSessionRoom, deviceSessionRoom } = require("../../apps/auth-api/auth/sessionVersion.ts")
    const { peerIdentityUserRoom } = require("../../apps/chat-api/socket/peerIdentity.ts")
    const { registerCallEndpoint } = require("../../apps/room-api/socket/directCall/ownership.ts")
    const { callStore } = require("../../apps/room-api/socket/directCall/redisService.ts")
    io.use(authSocket)
    io.on("connection", (socket) => {
        const user = socket.user
        const id = user.id
        assert.ok(id === 1 || id === 2)
        assert.ok(socket.data.accessSession.sessionId, "Every device has its own real authenticated session")
        socket.join(String(id))
        socket.join(accessSessionRoom(socket.data.accessSession.jti))
        socket.join(deviceSessionRoom(socket.data.accessSession.sessionId))
        socket.join(peerIdentityUserRoom(id))
        void registerCallEndpoint(socket, id).catch(() => socket.disconnect(true))
        socket.on("disconnect", () => {
            void Promise.resolve(socket.data.callEndpointReady).then(() => callStore.disconnectEndpoint(socket.id))
        })
        const emit = socket.emit.bind(socket)
        socket.emit = (event, ...args) => {
            if (event === "webrtc:config" && id === currentCalleeId && configDelayMs > 0) {
                delayedConfigurations.push({ userId: id, delayMs: configDelayMs })
                setTimeout(() => {
                    if (socket.connected) emit(event, ...args)
                }, configDelayMs)
                return socket
            }
            return emit(event, ...args)
        }
        socket.onAny((event, data) => {
            if (event === "call:start") currentCalleeId = id === 1 ? 2 : 1
            if (event.startsWith("call:") || event === "webrtc:signal")
                events.push({ userId: id, event, ...(event === "webrtc:signal" ? { type: data.type } : {}) })
        })
        attachSocketConnection(io, socket, user)
    })
    await vite.listen()
    const base = `http://127.0.0.1:${vite.config.server.port}`,
        audioFile = path.join(temporary, "microphone.wav")
    await fs.writeFile(audioFile, wav())
    browser = await chromium.launch({
        headless: true,
        ...(process.env.WEB_BROWSER_PATH ? { executablePath: process.env.WEB_BROWSER_PATH } : {}),
        args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            `--use-file-for-fake-audio-capture=${audioFile}`,
            "--autoplay-policy=no-user-gesture-required",
            "--mute-audio",
            "--disable-features=WebRtcHideLocalIpsWithMdns",
            "--force-webrtc-ip-handling-policy=default_public_and_private_interfaces"
        ]
    })
    for (const device of ["phone", "peer", "desktop"]) {
        const { userId: user, token } = deviceSessions.get(device)
        const context = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
            reducedMotion: "reduce",
            serviceWorkers: "block"
        })
        await context.addInitScript((forceRelay) => {
            window.__mediaConnections = []
            window.__captureRequests = 0
            window.__audioContextRequests = 0
            const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
            navigator.mediaDevices.getUserMedia = (...args) => {
                window.__captureRequests++
                return getUserMedia(...args)
            }
            const NativeAudioContext = window.AudioContext
            window.AudioContext = new Proxy(NativeAudioContext, {
                construct(target, args) {
                    window.__audioContextRequests++
                    return Reflect.construct(target, args)
                }
            })
            const Native = window.RTCPeerConnection
            window.RTCPeerConnection = new Proxy(Native, {
                construct(target, args) {
                    const pc = Reflect.construct(
                        target,
                        forceRelay ? [{ ...args[0], iceTransportPolicy: "relay" }] : args
                    )
                    window.__mediaConnections.push(pc)
                    return pc
                }
            })
        }, useLocalRelay)
        const page = await context.newPage()
        pages.push(page)
        page.on("pageerror", (error) => errors.push({ user, text: error.message }))
        page.on("console", (message) => {
            if (message.type() === "error") errors.push({ user, text: message.text() })
        })
        await page.route("**/*", (route) => {
            const url = new URL(route.request().url())
            if (url.origin === base || ["data:", "blob:"].includes(url.protocol)) return route.continue()
            if (
                url.origin === "https://cdn.jsdelivr.net" &&
                /^\/gh\/(shuding\/fluentui-emoji-unicode\/assets|googlefonts\/noto-emoji@)/.test(url.pathname)
            ) {
                localEmojiFixtures.push(url.pathname)
                return route.fulfill({
                    contentType: "image/svg+xml",
                    body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>'
                })
            }
            external.push(url.origin)
            return route.abort()
        })
        await page.addInitScript((token) => {
            window.handoffToken = token
        }, token)
        if (device === "desktop") continue
        await page.goto(`${base}/__call-handoff?user=${user}&device=${device}`)
        await page
            .getByTestId("signaling")
            .filter({ hasText: /^connected$/ })
            .waitFor()
    }
    await runHandoff(base)
    assert.deepEqual(errors, [])
    assert.deepEqual(external, [])
    const sourceHashesEnd = Object.fromEntries(
        await Promise.all(
            Object.keys(sourceHashes).map(async (file) => [
                file,
                crypto
                    .createHash("sha256")
                    .update(await fs.readFile(path.join(root, file)))
                    .digest("hex")
            ])
        )
    )
    assert.deepEqual(sourceHashesEnd, sourceHashes, "Runtime and harness source stay identical throughout final QA")
    await fs.writeFile(
        path.join(output, "report.json"),
        JSON.stringify(
            {
                passed: true,
                browser: browser.version(),
                realBackend: true,
                transport: useLocalRelay ? "isolated-local-TURN-TCP" : "host-direct-ICE",
                authenticatedDeviceSessions: 3,
                productionAuthUiCovered: false,
                baselineSource: baseline || null,
                sourceHashes,
                sourceHashesEnd,
                localEmojiFixtures,
                delayedConfigurations,
                events,
                snapshots,
                errors,
                external
            },
            null,
            4
        )
    )
    console.log(JSON.stringify({ passed: true, output, handoffs: 2, snapshots: snapshots.length }))
})()
    .catch(async (error) => {
        console.error(error)
        await fs.mkdir(output, { recursive: true })
        await fs.writeFile(
            path.join(output, "report.json"),
            JSON.stringify(
                {
                    passed: false,
                    error: String(error),
                    transport: useLocalRelay ? "isolated-local-TURN-TCP" : "host-direct-ICE",
                    browser: browser?.version(),
                    sourceHashes,
                    localEmojiFixtures,
                    delayedConfigurations,
                    events,
                    snapshots,
                    errors,
                    external,
                    failureObservations: await Promise.all(
                        pages.map((page) => observe(page).catch((error) => ({ error: String(error) })))
                    )
                },
                null,
                4
            )
        )
        for (const [index, page] of pages.entries())
            await page
                .screenshot({ path: path.join(output, `failure-user${index + 1}.png`), fullPage: true })
                .catch(() => {})
        process.exitCode = 1
    })
    .finally(async () => {
        await browser?.close()
        if (io) await new Promise((resolve) => io.close(resolve))
        await vite?.close()
        await Promise.allSettled([pool?.end(), redis?.quit()])
        await Promise.allSettled(containers.map((id) => exec("docker", ["rm", "-f", id], { timeout: 30000 })))
        if (temporary) await fs.rm(temporary, { recursive: true, force: true })
        process.exit(process.exitCode || 0)
    })
