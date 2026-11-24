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
const output = process.env.CALL_PARTICIPANTS_OUTPUT || path.join(root, "artifacts/direct-call-participants")
const containers = [],
    pages = [],
    errors = [],
    external = [],
    snapshots = [],
    events = []
const sourceHashes = {}
const useLocalRelay = process.env.CALL_PARTICIPANTS_DIRECT !== "1"
const configDelayMs = Number(process.env.CALL_PARTICIPANTS_CONFIG_DELAY_MS ?? 750)
assert.ok(Number.isInteger(configDelayMs) && configDelayMs >= 0 && configDelayMs <= 2000)
const delayedConfigurations = []
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
            states: window.callParticipantsQa.states,
            activeCall: window.callParticipantsQa.activeCall
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
function assertParticipants(observations) {
    observations.forEach((observation, index) => {
        assert.deepEqual(
            [...observation.state.activeCall.names].sort(),
            ["alex", "mira"],
            "Layout preserves both canonical identities"
        )
        assert.equal(observation.participants.length, 2, `user${index + 1} must render both participants`)
        for (const name of ["alex", "mira"]) {
            assert.equal(
                observation.participants.filter((text) => text.includes(name)).length,
                1,
                `user${index + 1}: ${name} exactly once`
            )
        }
        assert.equal(observation.participants.filter((text) => text.includes("Вы")).length, 1, "Exactly one self label")
    })
}
async function runCall(callerIndex, reconnect) {
    const caller = pages[callerIndex],
        receiver = pages[1 - callerIndex]
    const stage = callerIndex === 0 ? "alex-calls-mira" : "mira-calls-alex"
    await caller.getByRole("button", { name: `Позвонить ${callerIndex === 0 ? "mira" : "alex"}`, exact: true }).click()
    await receiver.getByRole("dialog", { name: "Входящий звонок" }).waitFor()
    await receiver.getByRole("button", { name: "Принять", exact: true }).click()
    await eventually(
        async () =>
            (await Promise.all(pages.map(stats))).every((connections) =>
                connections.some(
                    (pc) =>
                        pc.connection === "connected" &&
                        pc.inbound.some((track) => track.kind === "audio" && track.packets > 20 && track.energy > 0)
                )
            ),
        "bidirectional real RTP after accept"
    )
    const observations = await capture(stage)
    for (const observation of observations) {
        if (useLocalRelay) {
            assert.ok(
                observation.rtp
                    .filter((pc) => pc.connection === "connected")
                    .every((pc) =>
                        pc.selectedPairs.some(
                            (pair) =>
                                pair.localType === "relay" &&
                                pair.remoteType === "relay" &&
                                pair.relayProtocol === "tcp"
                        )
                    ),
                "Actual media uses the isolated TURN/TCP relay"
            )
        }
        const accepted = observation.state.states.filter((state) => state.status === "in_call").at(-1)
        assert.ok(accepted, "Both clients must receive accepted canonical call:state")
        assert.equal(accepted.caller.username, callerIndex === 0 ? "alex" : "mira")
        assert.equal(accepted.receiver.username, callerIndex === 0 ? "mira" : "alex")
    }
    assertParticipants(observations)
    if (reconnect) {
        const beforeReconnect = await Promise.all(pages.map(stats))
        const audioTotals = (connections) =>
            connections
                .filter((pc) => pc.connection !== "closed")
                .flatMap((pc) => pc.inbound)
                .reduce(
                    (totals, track) => ({
                        packets: totals.packets + track.packets,
                        energy: totals.energy + track.energy
                    }),
                    { packets: 0, energy: 0 }
                )
        const previousAudio = beforeReconnect.map(audioTotals)
        const prior = await caller.evaluate(() => window.callParticipantsQa.socket.id)
        const previousQueries = events.filter(
            (item) => item.userId === callerIndex + 1 && item.event === "call:current"
        ).length
        await caller.evaluate(() => window.callParticipantsQa.socket.io.engine.close())
        await eventually(
            async () =>
                (await caller.evaluate(
                    (previous) =>
                        window.callParticipantsQa.socket.connected && window.callParticipantsQa.socket.id !== previous,
                    prior
                )) &&
                events.filter((item) => item.userId === callerIndex + 1 && item.event === "call:current").length >
                    previousQueries,
            "call:current on signaling reconnect"
        )
        await eventually(
            async () =>
                (await Promise.all(pages.map(stats))).every((connections) =>
                    connections.some(
                        (pc) =>
                            pc.connection === "connected" &&
                            pc.inbound.some((track) => track.kind === "audio" && track.energy > 0)
                    )
                ),
            "RTP recovers"
        )
        await eventually(
            async () =>
                (await Promise.all(pages.map(stats))).every((connections, index) => {
                    const current = audioTotals(connections)
                    return (
                        current.packets > previousAudio[index].packets && current.energy > previousAudio[index].energy
                    )
                }),
            "received audio packets and decoded energy grow on both clients after reconnect"
        )
        const afterReconnect = await capture(stage + "-reconnected")
        snapshots.at(-1).audioBeforeReconnect = previousAudio
        assertParticipants(afterReconnect)
    }
    const end = caller.getByRole("button", { name: /Завершить|Завершение|Закончить|Сбросить/ })
    await end.click()
    await eventually(
        async () =>
            (await Promise.all(pages.map((page) => page.evaluate(() => window.callParticipantsQa.activeCall)))).every(
                (call) => call == null
            ),
        "both call panels close on hangup"
    )
    await eventually(
        async () =>
            (await Promise.all(pages.map(stats))).every((connections) =>
                connections.every((pc) => pc.connection === "closed")
            ),
        "all media peer connections close on hangup"
    )
}
;(async () => {
    await fs.mkdir(output, { recursive: true })
    for (const file of [
        "apps/frontend/src/pages/MainLayout/MainLayoutPage.tsx",
        "apps/frontend/src/utils/IncomingCallHandler.tsx",
        "apps/frontend/src/utils/directCallState.ts",
        "apps/frontend/src/pages/Talk/Remake/Talk.tsx",
        "apps/frontend/src/pages/Talk/Remake/hooks/useCallAudio.ts",
        "apps/frontend/src/webrtc/voiceMesh.ts",
        "apps/room-api/socket/directCall/index.ts",
        "scripts/fixtures/direct-call-participants-peer.tsx",
        "scripts/tests/direct-call-participants-ui.cjs"
    ]) {
        const source =
            file === "apps/frontend/src/pages/MainLayout/MainLayoutPage.tsx" && process.env.CALL_PARTICIPANTS_LAYOUT_SOURCE
                ? process.env.CALL_PARTICIPANTS_LAYOUT_SOURCE
                : path.join(root, file)
        sourceHashes[file] = crypto
            .createHash("sha256")
            .update(await fs.readFile(source))
            .digest("hex")
    }
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), "playtime-call-participants-"))
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
            "playtime.qa=call-participants",
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
            "playtime.qa=call-participants",
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
        JWT_SECRET_ENV: "isolated-call-participants-test-secret-not-production",
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
                "playtime.qa=call-participants",
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
    const { createServer } = await import("vite"),
        { default: react } = await import("@vitejs/plugin-react")
    const baseline = process.env.CALL_PARTICIPANTS_LAYOUT_SOURCE
    vite = await createServer({
        root,
        publicDir: path.join(root, "apps/frontend/public"),
        optimizeDeps: { entries: ["scripts/fixtures/direct-call-participants-peer.tsx"] },
        configFile: false,
        define: {
            "process.env.REACT_APP_WEB_BUILD": '"true"',
            "process.env.REACT_APP_API_BASE": '"/playtime"',
            "process.env.REACT_APP_SOCKET_URL": '""'
        },
        server: {
            port: Number(process.env.CALL_PARTICIPANTS_PORT || 4194),
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
                name: "call-participants-fixture",
                configureServer(server) {
                    server.middlewares.use("/__call-participants", async (_request, response) => {
                        response.setHeader("Content-Type", "text/html")
                        response.end(
                            await server.transformIndexHtml(
                                "/__call-participants",
                                '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/direct-call-participants-peer.tsx"></script></body></html>'
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
    io.on("connection", (socket) => {
        const id = Number(socket.handshake.auth.userId)
        assert.ok(id === 1 || id === 2)
        const user = { id, username: id === 1 ? "alex" : "mira" }
        socket.user = user
        socket.join(String(id))
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
    for (const user of [1, 2]) {
        const context = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
            reducedMotion: "reduce",
            serviceWorkers: "block"
        })
        await context.addInitScript((forceRelay) => {
            window.__mediaConnections = []
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
            external.push(url.origin)
            return route.abort()
        })
        await page.goto(`${base}/__call-participants?user=${user}`)
        await page
            .getByTestId("signaling")
            .filter({ hasText: /^connected$/ })
            .waitFor()
    }
    await runCall(0, true)
    await runCall(1, false)
    if (configDelayMs > 0) {
        assert.deepEqual(
            [...new Set(delayedConfigurations.map((item) => item.userId))].sort(),
            [1, 2],
            "Delayed callee startup was exercised in both directions"
        )
    }
    assert.deepEqual(errors, [])
    assert.deepEqual(external, [])
    await fs.writeFile(
        path.join(output, "report.json"),
        JSON.stringify(
            {
                passed: true,
                browser: browser.version(),
                realBackend: true,
                transport: useLocalRelay ? "isolated-local-TURN-TCP" : "host-direct-ICE",
                seededLocalSession: true,
                productionAuthUiCovered: false,
                baselineSource: baseline || null,
                sourceHashes,
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
    console.log(JSON.stringify({ passed: true, output, calls: 2, snapshots: snapshots.length }))
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
