const { io } = require('socket.io-client');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const nacl = require('tweetnacl');
const util = require('tweetnacl-util');

function encrypted(text) {
    const nonce = nacl.randomBytes(24);
    return (
        'R2E1:' +
        JSON.stringify({
            n: util.encodeBase64(nonce),
            b: util.encodeBase64(
                nacl.secretbox(util.decodeUTF8(text), nonce, new Uint8Array(32).fill(71)),
            ),
        })
    );
}

async function main() {
    const origin = process.env.PLAYTIME_HISTORY_FIXTURE || 'http://127.0.0.1:1506';
    const target = new URL(origin);
    if (target.hostname !== '127.0.0.1' || !['1502', '1504', '1506'].includes(target.port)) {
        throw new Error('Only an isolated local fixture is allowed');
    }
    const response = await fetch(origin + '/playtime/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nova@example.test', password: 'PlayTime-test-123' }),
    });
    if (!response.ok) throw new Error('Local peer login failed');
    const session = await response.json();
    const socket = io(origin, {
        path: '/playtime/socket.io',
        auth: { token: session.token },
        transports: ['websocket'],
        reconnection: false,
    });
    try {
        await new Promise((resolve, reject) => {
            socket.once('connect', resolve);
            socket.once('connect_error', reject);
        });
        let first;
        let latest;
        for (let index = 0; index < 60; index++) {
            const text =
                index === 0
                    ? 'Earlier history anchor'
                    : index === 59
                    ? 'Latest reply to the old anchor'
                    : `History item ${String(index).padStart(
                          2,
                          '0',
                      )} with enough text to exercise list measurement`;
            const result = await socket.timeout(5000).emitWithAck('message:send', {
                roomId: 10,
                content: encrypted(text),
                clientMessageId: randomUUID(),
                ...(index === 59 ? { replyToId: first } : {}),
            });
            if (!result.success) throw new Error('Peer send failed');
            first ??= result.id;
            latest = result.id;
        }
        socket.emit('room:setPin', { roomId: 10, messageId: first });
        await new Promise((resolve) => setTimeout(resolve, 200));
        const destination = path.resolve(__dirname, 'artifacts/history-seed.json');
        fs.writeFileSync(
            destination,
            JSON.stringify({ first, latest, count: 60, roomId: 10 }, null, 4),
        );
        process.stdout.write(JSON.stringify({ first, latest, count: 60 }) + '\n');
    } finally {
        socket.disconnect();
    }
}

main().catch((error) => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
});
