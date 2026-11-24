import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import path from 'node:path';
import { PlayTimeClient } from '../src/services/client';
import type { SecureStorage } from '../src/services/storage';

type Account = { id: number; username: string; email: string; password: string };
type Manifest = { runId: string; receiver: Account; sender: Account; expectedMessage: string };
class PrivateStorage implements SecureStorage {
    values: Record<string, string> = {};
    constructor(private file: string) {}
    async load() {
        this.values = JSON.parse(await readFile(this.file, 'utf8').catch(() => '{}'));
    }
    async get(key: string) {
        return this.values[key] ?? null;
    }
    async set(key: string, value: string) {
        this.values[key] = value;
        await this.save();
    }
    async remove(key: string) {
        delete this.values[key];
        await this.save();
    }
    private async save() {
        await writeFile(this.file, JSON.stringify(this.values), { mode: 0o600 });
        await chmod(this.file, 0o600);
    }
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, description: string) {
    for (let i = 0; i < 300; i++) {
        if (check()) return;
        await wait(100);
    }
    throw new Error(description);
}
async function main() {
    const [mode, source] = process.argv.slice(2);
    if (!['request', 'status', 'send', 'call', 'logout'].includes(mode) || !source)
        throw new Error('Expected QA mode and protected manifest path');
    const manifest: Manifest = JSON.parse(await readFile(source, 'utf8'));
    for (const account of [manifest.receiver, manifest.sender]) {
        if (
            !Number.isSafeInteger(account.id) ||
            account.id <= 0 ||
            !/^AndroidPushQA[a-f0-9]{2}$/.test(account.username) ||
            !account.email.endsWith('@example.invalid')
        )
            throw new Error('Only the authorized temporary QA manifest is accepted');
    }
    const privateDir = path.dirname(source);
    const artifacts = path.resolve(privateDir, '../artifacts');
    await mkdir(artifacts, { recursive: true, mode: 0o700 });
    const storage = new PrivateStorage(path.join(privateDir, 'sender-session.json'));
    await storage.load();
    const client = new PlayTimeClient({
        baseUrl: 'https://smeruxa.ru/playtime',
        socketUrl: 'https://smeruxa.ru',
        storage,
        timeoutMs: 15000,
    });
    let callId: string | null = null;
    try {
        await client.bootstrap();
        if (!client.snapshot.session)
            await client.login(manifest.sender.email, manifest.sender.password);
        await until(
            () => client.snapshot.connection === 'online' && client.snapshot.encryption.ready,
            'QA peer connection not ready',
        );
        if (
            client.snapshot.session?.user.id !== manifest.sender.id ||
            client.snapshot.encryption.needsRecovery
        )
            throw new Error('QA sender identity mismatch');
        if (mode === 'request') {
            await client.friendAction('request', manifest.receiver.username);
            await until(
                () => client.snapshot.outgoing.includes(manifest.receiver.username),
                'QA friendship request not reflected',
            );
            console.log(
                JSON.stringify({
                    status: 'requested',
                    receiverId: manifest.receiver.id,
                    senderId: manifest.sender.id,
                }),
            );
        } else if (mode === 'status') {
            await client.refreshHome();
            console.log(
                JSON.stringify({
                    status: 'ready',
                    accepted: client.snapshot.friends.some(
                        (friend) =>
                            friend.friend_username === manifest.receiver.username &&
                            friend.status === 'accepted',
                    ),
                }),
            );
        } else if (mode === 'send') {
            await client.refreshHome();
            if (
                !client.snapshot.friends.some(
                    (friend) =>
                        friend.friend_username === manifest.receiver.username &&
                        friend.status === 'accepted',
                )
            )
                throw new Error('Only the accepted temporary QA receiver may receive this message');
            await client.openChat({
                id: manifest.receiver.id,
                name: manifest.receiver.username,
                isRoom: false,
            });
            await client.sendMessage(manifest.expectedMessage);
            const message = client.snapshot.messages.filter((item) => item.me).at(-1);
            if (!message || message.text !== manifest.expectedMessage)
                throw new Error('QA encrypted send not confirmed');
            const proof = {
                status: 'sent',
                messageId: message.id,
                senderId: manifest.sender.id,
                receiverId: manifest.receiver.id,
            };
            await writeFile(path.join(artifacts, 'peer-send.json'), JSON.stringify(proof, null, 4));
            console.log(JSON.stringify(proof));
        } else if (mode === 'call') {
            const cancel = path.join(privateDir, 'cancel-call');
            const controlPresent = await readFile(cancel)
                .then(() => true)
                .catch(() => false);
            if (controlPresent) throw new Error('Remove stale QA call cancellation control first');
            type CallState = {
                roomId?: string;
                status?: string;
                expiresAt?: number;
                receiver?: { id?: number };
            };
            const startedAt = Date.now();
            const response = await client.ack<{ roomId: string; state?: CallState }>('call:start', {
                username: manifest.receiver.username,
            });
            callId = response.roomId;
            if (!callId) throw new Error('QA call did not start');
            const samples: Record<string, unknown>[] = [];
            const summarize = (state: CallState | null | undefined) => ({
                statePresent: !!state,
                status:
                    state && ['request_receiver', 'in_call'].includes(state.status ?? '')
                        ? state.status
                        : null,
                receiverIdType: typeof state?.receiver?.id,
                receiverMatchesQa: state?.receiver?.id === manifest.receiver.id,
                roomMatchesStartedCall: state?.roomId === callId,
                expiryType: typeof state?.expiresAt,
                expiryDeltaMs: Number.isFinite(state?.expiresAt)
                    ? state!.expiresAt! - Date.now()
                    : null,
            });
            const proof: Record<string, unknown> = {
                status: 'ringing',
                receiverId: manifest.receiver.id,
                startedAtUtc: new Date(startedAt).toISOString(),
                cancelControlPresentAtStart: controlPresent,
                startAck: summarize(response.state),
                samples,
            };
            const saveCallProof = () =>
                writeFile(path.join(artifacts, 'peer-call.json'), JSON.stringify(proof, null, 4));
            await saveCallProof();
            console.log(JSON.stringify({ status: 'ringing', receiverId: manifest.receiver.id }));
            let reason = 'bounded_deadline';
            let polls = 0;
            while (Date.now() - startedAt < 75_000) {
                if (
                    await readFile(cancel)
                        .then(() => true)
                        .catch(() => false)
                ) {
                    reason = 'operator_cancel_control';
                    break;
                }
                let reply: unknown;
                try {
                    reply = await client.socket!.timeout(5000).emitWithAck('call:current');
                } catch {
                    proof.status = 'failed';
                    proof.stopReason = 'poll_transport_error';
                    proof.elapsedMs = Date.now() - startedAt;
                    await saveCallProof();
                    throw new Error('QA call state polling failed');
                }
                const current = (reply && typeof reply === 'object' ? reply : {}) as {
                    state?: CallState | null;
                    err?: unknown;
                };
                polls++;
                const sample = {
                    elapsedMs: Date.now() - startedAt,
                    replyType: reply === null ? 'null' : typeof reply,
                    replyIsArray: Array.isArray(reply),
                    stateFieldPresent: Object.hasOwn(current, 'state'),
                    errorPresent: Object.hasOwn(current, 'err'),
                    ...summarize(current.state),
                };
                if (polls === 1 || polls % 10 === 0 || !current.state || current.err) {
                    samples.push(sample);
                    await saveCallProof();
                }
                if (current.err) {
                    reason = 'server_error_ack';
                    break;
                }
                if (!current.state) {
                    reason = Object.hasOwn(current, 'state') ? 'server_state_null' : 'state_field_missing';
                    break;
                }
                await wait(250);
            }
            proof.status = 'finished';
            proof.stopReason = reason;
            proof.polls = polls;
            proof.elapsedMs = Date.now() - startedAt;
            proof.finishedAtUtc = new Date().toISOString();
            await saveCallProof();
            console.log(JSON.stringify({ status: 'call_finished', reason, elapsedMs: proof.elapsedMs }));
        } else {
            await client.logout();
            console.log(JSON.stringify({ status: 'sender_logged_out' }));
        }
    } finally {
        if (callId) {
            client.socket?.emit('call:end', { roomId: callId });
            await wait(200);
        }
        client.dispose();
    }
}
void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'QA peer failed');
    process.exitCode = 1;
});
