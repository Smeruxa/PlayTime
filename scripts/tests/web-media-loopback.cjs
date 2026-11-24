const assert = require("node:assert/strict")
const path = require("node:path")
const fs = require("node:fs/promises")
const os = require("node:os")
const { createRequire } = require("node:module")
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
const root = path.resolve(__dirname, "../..")
const backendRequire = createRequire(path.join(root, "apps/package.json"))
const { Server } = backendRequire("socket.io")
const output = process.env.WEB_MEDIA_SCREENSHOT_DIR || path.join(root, "artifacts/web-media-qa")
let vite, io, browser, temporary
const errors = [], external = [], signals = [], resumes = [], unknown = [], snapshots = []
const pages = []

function wav() {
    const sampleRate = 48000, seconds = 4, samples = sampleRate * seconds, result = Buffer.alloc(44 + samples * 2)
    result.write("RIFF"); result.writeUInt32LE(result.length - 8, 4); result.write("WAVEfmt ", 8)
    result.writeUInt32LE(16, 16); result.writeUInt16LE(1, 20); result.writeUInt16LE(1, 22)
    result.writeUInt32LE(sampleRate, 24); result.writeUInt32LE(sampleRate * 2, 28); result.writeUInt16LE(2, 32); result.writeUInt16LE(16, 34)
    result.write("data", 36); result.writeUInt32LE(samples * 2, 40)
    for (let index = 0; index < samples; index++) result.writeInt16LE(Math.round(Math.sin(index / sampleRate * Math.PI * 2 * (240 + index % 48000 / 240)) * 10000), 44 + index * 2)
    return result
}
async function stats(page) {
    return page.evaluate(async () => Promise.all(window.__mediaConnections.map(async pc => {
        const reports = await pc.getStats(), inbound = [], outbound = [], candidates = [], pairs = [], selectedPairs = []
        reports.forEach(report => {
            if (report.type === "inbound-rtp") inbound.push({ kind: report.kind, packets: report.packetsReceived || 0, bytes: report.bytesReceived || 0, energy: report.totalAudioEnergy || 0, frames: report.framesDecoded || 0 })
            if (report.type === "outbound-rtp") outbound.push({ kind: report.kind, packets: report.packetsSent || 0, bytes: report.bytesSent || 0, frames: report.framesEncoded || 0 })
            if (["local-candidate", "remote-candidate"].includes(report.type)) candidates.push({ side: report.type, type: report.candidateType, protocol: report.protocol, relayProtocol: report.relayProtocol, addressKind: report.address?.endsWith(".local") ? "mdns" : report.address?.includes(":") ? "ipv6" : "ipv4" })
            if (report.type === "candidate-pair") pairs.push({ state: report.state, nominated: report.nominated, requestsSent: report.requestsSent, responsesReceived: report.responsesReceived })
            if (report.type === "transport" && report.selectedCandidatePairId) {
                const pair = reports.get(report.selectedCandidatePairId), local = reports.get(pair?.localCandidateId), remote = reports.get(pair?.remoteCandidateId)
                if (pair) selectedPairs.push({ state: pair.state, nominated: pair.nominated, localType: local?.candidateType, remoteType: remote?.candidateType, relayProtocol: local?.relayProtocol })
            }
        })
        return { connection: pc.connectionState, ice: pc.iceConnectionState, inbound, outbound, candidates, pairs, selectedPairs, senders: pc.getSenders().map(sender => ({ kind: sender.track?.kind, enabled: sender.track?.enabled, state: sender.track?.readyState })) }
    })))
}
async function waitFor(check, description) {
    const until = Date.now() + 25000
    while (Date.now() < until) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
    throw new Error("Timed out: " + description)
}
async function shot(page, name) {
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(180)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, name + " overflows")
    await page.screenshot({ path: path.join(output, name + ".png"), fullPage: true })
}

;(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), "playtime-media-loopback-"))
    const audioFile = path.join(temporary, "synthetic-microphone.wav")
    await fs.writeFile(audioFile, wav()); await fs.mkdir(output, { recursive: true })
    const iceServers = process.env.WEB_MEDIA_ICE_CONFIG_FILE ? JSON.parse(await fs.readFile(process.env.WEB_MEDIA_ICE_CONFIG_FILE, "utf8")).iceServers : [{ urls: "stun:127.0.0.1:9" }]
    assert.ok(Array.isArray(iceServers) && iceServers.length)
    const { createServer } = await import("vite"), { default: react } = await import("@vitejs/plugin-react")
    vite = await createServer({ root, publicDir: path.join(root, "apps/frontend/public"), optimizeDeps: { entries: ["scripts/fixtures/web-media-peer.tsx"] }, configFile: false, base: "/", define: { "process.env.REACT_APP_WEB_BUILD": JSON.stringify("true"), "process.env.REACT_APP_API_BASE": JSON.stringify("/playtime"), "process.env.REACT_APP_SOCKET_URL": JSON.stringify("") }, server: { port: Number(process.env.WEB_MEDIA_UI_PORT || 4190), host: "127.0.0.1", strictPort: true, hmr: false, watch: null }, plugins: [react(), {
        name: "media-loopback-fixture",
        configureServer(server) {
            server.middlewares.use("/__media-peer", async (_request, response) => {
                response.setHeader("Content-Type", "text/html")
                response.end(await server.transformIndexHtml("/__media-peer", '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root" style="display:flex"></div><script type="module" src="/scripts/fixtures/web-media-peer.tsx"></script></body></html>'))
            })
        }
    }] })
    io = new Server(vite.httpServer, { path: "/qa-media-socket" })
    io.on("connection", socket => {
        const userId = Number(socket.handshake.auth.userId), username = userId === 1 ? "alex" : "mira"
        assert.ok(userId === 1 || userId === 2); socket.join(String(userId))
        socket.onAny((event, payload, ack) => {
            if (event === "webrtc:signal") {
                assert.equal(payload.roomId, "1:2"); assert.equal(payload.targetUserId, userId === 1 ? 2 : 1)
                signals.push({ from: userId, type: payload.type, ufrag: payload.payload.sdp?.match(/a=ice-ufrag:([^\r\n]+)/)?.[1] })
                io.to(String(payload.targetUserId)).emit("webrtc:signal", { ...payload, fromUserId: userId, fromUsername: username })
            } else if (event === "webrtc:screen:state") io.to(String(userId === 1 ? 2 : 1)).emit(event, { ...payload, fromUserId: userId, fromUsername: username })
            else if (event === "webrtc:config:request") socket.emit("webrtc:config", { iceServers })
            else if (event === "profile:friendsAvatars") ack?.({})
            else if (event === "profile:get") ack?.({ profile: { username: payload?.username } })
            else if (event === "call:resume") { resumes.push(userId); ack?.({ success: true, status: "in_call" }) }
            else if (event === "call:end") io.emit("call:ended", { roomId: "1:2" })
            else if (event === "ping:measure") ack?.(payload)
            else if (event !== "call:heartbeat") unknown.push(event)
        })
    })
    await vite.listen()
    const base = `http://127.0.0.1:${vite.config.server.port}`
    browser = await chromium.launch({ headless: true, ...(process.env.WEB_BROWSER_PATH ? { executablePath: process.env.WEB_BROWSER_PATH } : {}), args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${audioFile}`, "--autoplay-policy=no-user-gesture-required", "--mute-audio", "--disable-features=WebRtcHideLocalIpsWithMdns", "--force-webrtc-ip-handling-policy=default_public_and_private_interfaces"] })
    for (const [user, width, height] of [[1, 1440, 1000], [2, 390, 844]]) {
        const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce", serviceWorkers: "block" })
        await context.addInitScript(({ forceRelay, desktop }) => {
            window.__mediaConnections = []
            window.__displayCaptureCalls = 0
            if (desktop) window.electronAPI = {
                getScreenSources: async () => [{ id: "screen:qa", name: "Тестовый экран", thumbnail: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='360'%3E%3Crect width='640' height='360' fill='%2312345c'/%3E%3C/svg%3E" }],
                selectScreenSource: async sourceId => { window.__selectedScreenSource = sourceId }
            }
            const native = window.RTCPeerConnection
            window.RTCPeerConnection = new Proxy(native, { construct(target, args) { const configuration = forceRelay ? [{ ...args[0], iceTransportPolicy: "relay" }] : args; const pc = Reflect.construct(target, configuration); window.__mediaConnections.push(pc); return pc } })
            Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", { value: async () => {
                window.__displayCaptureCalls++
                const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360
                const painter = canvas.getContext("2d"), start = Date.now()
                const draw = () => { painter.fillStyle = "#12345c"; painter.fillRect(0, 0, 640, 360); painter.fillStyle = "#20c9ee"; painter.fillRect((Date.now() - start) / 10 % 540, 220, 100, 60); painter.fillStyle = "white"; painter.font = "32px sans-serif"; painter.fillText("PlayTime · живой экран", 40, 90); painter.fillText(String(Date.now() - start) + " ms", 40, 150) }
                draw(); const stream = canvas.captureStream(15), video = stream.getVideoTracks()[0]
                const interval = setInterval(() => { if (video.readyState === "ended") clearInterval(interval); else draw() }, 60)
                const audio = new AudioContext(), oscillator = audio.createOscillator(), gain = audio.createGain(), destination = audio.createMediaStreamDestination()
                oscillator.frequency.value = 880; gain.gain.value = 0.08; oscillator.connect(gain).connect(destination); oscillator.start(); await audio.resume()
                stream.addTrack(destination.stream.getAudioTracks()[0])
                return stream
            } })
        }, { forceRelay: !!process.env.WEB_MEDIA_ICE_CONFIG_FILE, desktop: user === 1 })
        const page = await context.newPage(); pages.push(page)
        page.setDefaultTimeout(20000)
        page.on("pageerror", error => errors.push({ user, text: error.message }))
        page.on("console", message => { if (message.type() === "error") errors.push({ user, text: message.text() }) })
        await page.route("**/*", route => { const url = new URL(route.request().url()); if (url.origin === base || ["data:", "blob:"].includes(url.protocol)) return route.continue(); external.push(url.origin); return route.abort() })
        await page.goto(`${base}/__media-peer?user=${user}`)
        await page.getByText("Сигнализация подключена", { exact: false }).waitFor()
    }
    const [caller, receiver] = pages
    console.log("Connecting the two native WebRTC peers")
    await receiver.getByRole("button", { name: "Подключиться к звонку" }).click()
    await receiver.getByRole("list", { name: "Участники звонка" }).waitFor()
    await caller.getByRole("button", { name: "Подключиться к звонку" }).click()
    await waitFor(async () => (await Promise.all(pages.map(stats))).every(connections => connections.some(pc => pc.connection === "connected" && pc.inbound.some(track => track.kind === "audio" && track.packets > 20 && track.energy > 0))), "bidirectional decoded microphone audio")
    snapshots.push({ stage: "audio", peers: await Promise.all(pages.map(stats)) })
    console.log("Microphone audio is decoded in both directions")
    await caller.evaluate(() => window.mediaQa.setParticipantVolume("mira", 25))
    await caller.waitForFunction(() => Array.from(document.querySelectorAll("audio")).some(audio => audio.srcObject && audio.volume === 0.25))
    await caller.evaluate(() => window.mediaQa.setParticipantVolume("mira", 100))
    await shot(caller, "call-connected-desktop"); await shot(receiver, "call-connected-mobile")
    assert.equal(await receiver.getByRole("button", { name: "Демонстрация экрана", exact: true }).isDisabled(), true)
    assert.match(await receiver.evaluate(() => window.mediaQa.attemptCapture()), /доступна в приложении PlayTime/)
    assert.match(await receiver.evaluate(() => window.mediaQa.attemptCapture("screen:qa")), /доступна в приложении PlayTime/)
    assert.equal(await receiver.evaluate(() => window.__displayCaptureCalls), 0, "Web mode cannot invoke native screen capture, even with a source ID")
    await receiver.getByRole("button", { name: "Проверить ограничение демонстрации", exact: true }).click()
    await receiver.getByText("Демонстрация экрана доступна в приложении PlayTime.", { exact: true }).waitFor()
    assert.equal(await receiver.getByRole("button", { name: "Выбрать экран", exact: true }).count(), 0)
    await shot(receiver, "web-share-blocked-mobile")
    await receiver.getByRole("button", { name: "Понятно", exact: true }).click()
    await caller.getByRole("button", { name: "Выключить микрофон", exact: true }).click()
    assert.equal((await stats(caller))[0].senders.find(track => track.kind === "audio").enabled, false)
    await caller.getByRole("button", { name: "Включить микрофон", exact: true }).click()
    await caller.getByRole("button", { name: "Демонстрация экрана", exact: true }).click()
    await caller.getByRole("button", { name: "Тестовый экран", exact: true }).waitFor()
    await shot(caller, "desktop-screen-picker")
    await caller.getByRole("button", { name: "Тестовый экран", exact: true }).click()
    assert.equal(await caller.evaluate(() => window.__selectedScreenSource), "screen:qa")
    await waitFor(async () => (await stats(receiver))[0].inbound.some(track => track.kind === "video" && track.frames > 5), "real video decoding after screen renegotiation")
    await waitFor(async () => (await stats(receiver))[0].inbound.filter(track => track.kind === "audio" && track.energy > 0).length === 2, "screen audio separate from microphone")
    await shot(caller, "screen-sender-desktop"); await shot(receiver, "screen-receiver-mobile")
    snapshots.push({ stage: "desktop-screen-to-web", peers: await Promise.all(pages.map(stats)) })
    const oldOffer = signals.filter(signal => signal.from === 1 && signal.type === "offer").at(-1).ufrag
    await caller.evaluate(() => window.mediaQa.socket.io.engine.close())
    await waitFor(async () => resumes.includes(1) && signals.some(signal => signal.from === 1 && signal.type === "offer" && signal.ufrag && signal.ufrag !== oldOffer) && (await Promise.all(pages.map(stats))).every(peers => peers.every(pc => pc.connection === "connected" && pc.selectedPairs.some(pair => pair.state === "succeeded" && pair.nominated))), "Socket.IO reconnect followed by completed ICE restart on both peers")
    snapshots.push({ stage: "ice-restart", peers: await Promise.all(pages.map(stats)) })
    if (process.env.WEB_MEDIA_ICE_CONFIG_FILE) {
        for (const snapshot of snapshots) for (const peers of snapshot.peers) for (const peer of peers)
            assert.ok(peer.selectedPairs.some(pair => pair.state === "succeeded" && pair.nominated && (pair.localType === "relay" || pair.remoteType === "relay")), `Media uses a nominated TURN relay pair at ${snapshot.stage}`)
    }
    await shot(caller, "reconnected-desktop")
    await caller.getByRole("button", { name: "Демонстрация экрана", exact: true }).click()
    await caller.getByRole("button", { name: "Завершить звонок", exact: true }).click()
    await receiver.getByRole("button", { name: "Подключиться к звонку" }).waitFor()
    await waitFor(async () => (await Promise.all(pages.map(stats))).every(connections => connections.every(pc => pc.connection === "closed")), "peer connections closed on hangup")
    await caller.getByRole("button", { name: "Записать голосовое" }).click()
    await caller.getByText("Идёт запись", { exact: true }).waitFor()
    await caller.waitForTimeout(1500)
    await caller.getByRole("button", { name: "Остановить запись" }).click()
    await caller.getByText("Запись готова", { exact: true }).waitFor()
    const recording = await caller.evaluate(() => window.mediaQa.recording())
    assert.ok(recording.bytes > 1000 && recording.duration >= 1 && recording.rms > 0.001)
    await shot(caller, "voice-recorded-desktop")
    assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(unknown, [])
    const report = { browser: browser.version(), widths: [1440, 390], forcedRelay: !!process.env.WEB_MEDIA_ICE_CONFIG_FILE, nativePeerConnections: true, microphone: "generated WAV through native getUserMedia", screen: "desktop bridge fixture sends canvas video and oscillator audio to web receiver through real WebRTC", webScreenCaptureBlocked: true, signals: signals.map(({ from, type }) => ({ from, type })), resumes, snapshots, recording, errors, external, unknown }
    for (const name of ["failure-peer-1.png", "failure-peer-2.png", "screens-both-desktop.png", "screens-both-mobile.png"]) await fs.rm(path.join(output, name), { force: true })
    await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ output, browser: report.browser, widths: report.widths, screenshots: 8, stages: snapshots.map(snapshot => snapshot.stage), signalingMessages: signals.length, resumes, recording, errors, external, unknown }))
})().catch(async error => {
    console.error(error); console.error(JSON.stringify({ errors, external, signals: signals.map(({ from, type }) => ({ from, type })), unknown }))
    for (const [index, page] of pages.entries()) {
        console.error("Peer", index + 1, JSON.stringify(await stats(page).catch(() => [])))
        await page.screenshot({ path: path.join(output, `failure-peer-${index + 1}.png`), fullPage: true }).catch(() => {})
    }
    process.exitCode = 1
}).finally(async () => {
    await browser?.close()
    if (io) await new Promise(resolve => io.close(resolve))
    await vite?.close()
    if (temporary) await fs.rm(temporary, { recursive: true, force: true })
})
