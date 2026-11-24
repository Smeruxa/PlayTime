const http = require('node:http'), net = require('node:net'), fs = require('node:fs/promises')
const { once } = require('node:events'), { promisify } = require('node:util'), { execFile } = require('node:child_process'), crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const exec = promisify(execFile)
let server, browser, container
const docker = async (...args) => (await exec('docker', args, { timeout: 60000 })).stdout.trim()
;(async () => {
    assert.match(await docker('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'), /^unix:\/\//)
    const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening')
    const turnPort = listener.address().port; await new Promise(resolve => listener.close(resolve))
    const credential = crypto.randomBytes(20).toString('hex')
    container = await docker('run', '--rm', '-d', '--name', `playtime-qa-turn-${crypto.randomBytes(6).toString('hex')}`, '--label', 'playtime.qa=ice-control', '--label', `playtime.qa.owner=${process.env.WEB_ICE_OWNER || 'standalone'}`, '-p', `127.0.0.1:${turnPort}:3478/tcp`, '-p', `127.0.0.1:${turnPort}:3478/udp`, 'coturn/coturn:4.6.3', '-n', '--listening-port=3478', '--fingerprint', '--lt-cred-mech', '--user=qa:' + credential, '--realm=playtime.test', '--no-tls', '--no-dtls', '--no-cli', '--log-file=stdout', '--min-port=49160', '--max-port=49180', '--allow-loopback-peers')
    server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Local ICE control</title>') }); server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const iceServers = [{ urls: `turn:127.0.0.1:${turnPort}?transport=tcp`, username: 'qa', credential }]
    browser = await chromium.launch({ headless: true, ...(process.env.WEB_BROWSER_PATH ? { executablePath: process.env.WEB_BROWSER_PATH } : {}), args: ['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns', '--force-webrtc-ip-handling-policy=default_public_and_private_interfaces'] })
    const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`)
    const results = []
    for (const [name, configuration] of [['direct', { iceServers: [] }], ['turn-tcp', { iceServers, iceTransportPolicy: 'relay' }]]) {
        const result = await page.evaluate(async ({ name, configuration }) => {
            const peers = [new RTCPeerConnection(configuration), new RTCPeerConnection(configuration)]
            const errors = [], states = []
            const done = new Promise(resolve => {
                const timer = setTimeout(() => resolve(false), 12000)
                peers[1].ondatachannel = event => { event.channel.onmessage = message => { if (message.data === 'playtime-loopback') { clearTimeout(timer); resolve(true) } } }
            })
            for (const [index, peer] of peers.entries()) peer.oniceconnectionstatechange = () => states.push({ peer: index, ice: peer.iceConnectionState })
            const channel = peers[0].createDataChannel('playtime-test')
            channel.onopen = () => channel.send('playtime-loopback')
            const gather = peer => new Promise(resolve => {
                if (peer.iceGatheringState === 'complete') return resolve()
                const timer = setTimeout(resolve, 5000)
                peer.addEventListener('icegatheringstatechange', () => { if (peer.iceGatheringState === 'complete') { clearTimeout(timer); resolve() } })
            })
            try {
                await peers[0].setLocalDescription(await peers[0].createOffer()); await gather(peers[0])
                await peers[1].setRemoteDescription(peers[0].localDescription)
                await peers[1].setLocalDescription(await peers[1].createAnswer()); await gather(peers[1])
                await peers[0].setRemoteDescription(peers[1].localDescription)
            } catch (error) { errors.push(String(error)) }
            const received = await done
            const stats = await Promise.all(peers.map(async peer => {
                const reports = await peer.getStats(), candidates = [], pairs = []
                reports.forEach(report => {
                    if (['local-candidate', 'remote-candidate'].includes(report.type)) candidates.push({ side: report.type, kind: report.candidateType, protocol: report.protocol, relayProtocol: report.relayProtocol })
                    if (report.type === 'candidate-pair') pairs.push({ state: report.state, nominated: report.nominated, requestsSent: report.requestsSent, responsesReceived: report.responsesReceived, bytesSent: report.bytesSent, bytesReceived: report.bytesReceived })
                })
                return { connection: peer.connectionState, ice: peer.iceConnectionState, candidates, pairs }
            }))
            peers.forEach(peer => peer.close())
            return { name, received, states, stats, errors }
        }, { name, configuration })
        results.push(result); console.log(JSON.stringify({ stage: name, received: result.received, connections: result.stats.map(item => item.connection), candidates: result.stats.map(item => item.candidates) }))
    }
    const report = { browser: browser.version(), nativePeerConnections: true, localTURN: true, results }
    if (process.env.WEB_ICE_REPORT) await fs.writeFile(process.env.WEB_ICE_REPORT, JSON.stringify(report, null, 2) + '\n')
    if (results[1].received && process.env.WEB_ICE_KEEP_CONFIG) {
        await fs.writeFile(process.env.WEB_ICE_KEEP_CONFIG, JSON.stringify({ container, iceServers }), { mode: 0o600 })
        container = null
    }
    assert.equal(results[1].received, true, 'Local TURN/TCP must transfer data between native peers')
})().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); if (container) await docker('rm', '-f', container).catch(() => {}) })
