const { app, BrowserWindow, session } = require('electron');
const http = require('node:http');
const path = require('node:path');
const dgram = require('node:dgram');
const { createRequire } = require('node:module');

const base = process.env.PLAYTIME_TEST_URL ?? 'http://127.0.0.1:1502';
const controlPort = Number(process.env.PLAYTIME_PEER_PORT ?? 1503);
const username = process.env.PLAYTIME_PEER_USERNAME ?? 'Nova';
const desktopMesh = process.env.PLAYTIME_PEER_DESKTOP_MESH === '1';
const useTurn = process.env.PLAYTIME_TEST_TURN === '1';
const parsed = new URL(base);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    throw new Error('The call peer only connects to a local E2E fixture.');
}
const mobileRequire = createRequire(require.resolve('../package.json'));
const socketEntry = mobileRequire.resolve('socket.io-client/package.json');
const socketScript = path.join(path.dirname(socketEntry), 'dist/socket.io.min.js');
let window;
let server;
let shuttingDown = false;
const relays = new Map();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
app.commandLine.appendSwitch('allow-loopback-in-peer-connection');

async function emulatorCandidate(candidate) {
    if (!candidate?.candidate) {
        return candidate;
    }
    const fields = candidate.candidate.split(' ');
    const address = fields[4];
    const port = Number(fields[5]);
    if (fields[2]?.toLowerCase() !== 'udp' || !/^\d+\.\d+\.\d+\.\d+$/.test(address)) {
        return candidate;
    }
    const key = `${address}:${port}`;
    let relay = relays.get(key);
    if (!relay) {
        const socket = dgram.createSocket('udp4');
        relay = { socket, client: null, port: 0, inbound: 0, outbound: 0 };
        const current = relay;
        socket.on('error', (error) => console.error('E2E UDP bridge:', error.message));
        socket.on('message', (packet, source) => {
            if (source.port === port && source.address === address) {
                current.outbound++;
                if (current.client) {
                    socket.send(packet, current.client.port, current.client.address);
                }
            } else {
                current.inbound++;
                current.client = source;
                socket.send(packet, port, address);
            }
        });
        await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve));
        relay.port = socket.address().port;
        relays.set(key, relay);
    }
    fields[4] = '10.0.2.2';
    fields[5] = String(relay.port);
    return { ...candidate, candidate: fields.join(' ') };
}

async function invoke(method, argument) {
    if (!window || window.isDestroyed()) {
        throw new Error('Peer window is unavailable');
    }
    if (
        ![
            'status',
            'call',
            'hangup',
            'share',
            'mute',
            'reconnect',
            'joinParty',
            'leaveParty',
            'accept',
            'reject',
        ].includes(method)
    ) {
        throw new Error('Unknown peer command');
    }
    return window.webContents.executeJavaScript(
        `window.playtimePeer[${JSON.stringify(method)}](${JSON.stringify(argument ?? null)})`,
    );
}

async function initializePeer() {
    relays.forEach((relay) => relay.socket.close());
    relays.clear();
    const response = await fetch(`${base}/playtime/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: `${username.toLowerCase()}@example.test`,
            password: 'PlayTime-test-123',
            deviceName: 'Electron E2E peer',
        }),
    });
    const login = await response.json();
    if (!response.ok || !login.token) {
        throw new Error(login.error ?? 'Fixture login failed');
    }
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
        callback(true),
    );
    window ??= new BrowserWindow({
        width: 720,
        height: 620,
        show: process.env.PLAYTIME_PEER_SHOW === '1',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
        },
    });
    await window.loadFile(path.join(__dirname, 'call-peer.html'));
    const fs = require('node:fs');
    await window.webContents.executeJavaScript(
        fs.readFileSync(path.join(__dirname, 'call-peer-renderer.js'), 'utf8') + '\nvoid 0;',
    );
    await window.webContents.executeJavaScript(fs.readFileSync(socketScript, 'utf8'));
    if (desktopMesh) {
        const { build } = require('esbuild');
        const bundle = await build({
            entryPoints: [path.join(__dirname, 'desktop-mesh-entry.ts')],
            bundle: true,
            write: false,
            format: 'iife',
            globalName: 'PlayTimeDesktop',
            platform: 'browser',
            target: 'chrome130',
        });
        await window.webContents.executeJavaScript(bundle.outputFiles[0].text);
    }
    await window.webContents.executeJavaScript(
        `window.startPlaytimePeer(${JSON.stringify({
            base,
            token: login.token,
            user: login.user,
            autoAnswer: process.env.PLAYTIME_PEER_AUTO_ANSWER !== '0',
            control: `http://127.0.0.1:${controlPort}`,
            desktopMesh,
            useTurn,
        })})`,
    );
}

async function start() {
    await initializePeer();
    server = http.createServer(async (request, responseStream) => {
        const reply = (status, data) => {
            responseStream.writeHead(status, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
            });
            responseStream.end(JSON.stringify(data));
        };
        try {
            if (request.method === 'OPTIONS') {
                reply(200, {});
                return;
            }
            if (request.method === 'GET' && request.url === '/status') {
                reply(200, await invoke('status'));
                return;
            }
            if (request.method === 'GET' && request.url === '/screenshot') {
                const screenshot = await window.webContents.capturePage();
                responseStream.writeHead(200, { 'Content-Type': 'image/png' });
                responseStream.end(screenshot.toPNG());
                return;
            }
            if (request.method === 'GET' && request.url === '/bridges') {
                reply(
                    200,
                    [...relays.entries()].map(([target, relay]) => ({
                        target,
                        port: relay.port,
                        client: relay.client,
                        inbound: relay.inbound,
                        outbound: relay.outbound,
                    })),
                );
                return;
            }
            if (request.method === 'POST' && request.url === '/reset') {
                await initializePeer();
                reply(200, { success: true });
                return;
            }
            if (request.method !== 'POST') {
                reply(404, { error: 'Unknown command' });
                return;
            }
            let body = '';
            for await (const chunk of request) {
                body += chunk;
                if (body.length > 4096) {
                    reply(413, { error: 'Payload too large' });
                    return;
                }
            }
            const data = body ? JSON.parse(body) : {};
            if (request.url === '/ice') {
                reply(200, await emulatorCandidate(data));
                return;
            }
            const method = request.url.slice(1);
            reply(200, await invoke(method, data));
        } catch (error) {
            reply(500, { error: error.message });
        }
    });
    server.listen(controlPort, '127.0.0.1', () =>
        console.log(
            `PlayTime WebRTC ${username} peer control: http://127.0.0.1:${controlPort}/status`,
        ),
    );
}

async function shutdown() {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;
    try {
        await invoke('hangup');
    } catch {}
    server?.close();
    relays.forEach((relay) => relay.socket.close());
    app.quit();
}
app.whenReady()
    .then(start)
    .catch((error) => {
        console.error(error);
        app.exit(1);
    });
app.on('window-all-closed', () => {
    void shutdown();
});
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
        void shutdown();
    });
}
