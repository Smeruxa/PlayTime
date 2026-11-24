import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { decryptDmCiphertext } from '../../apps/frontend/src/features/chat/dmE2ee';
import { decodeMediaMessage, mediaBlobForPlayback } from '../../apps/frontend/src/features/chat/mediaEncryption';

async function main() {
    const output = path.resolve(process.argv[2]);
    const origin = 'http://127.0.0.1:1502';
    const state = JSON.parse(await readFile(path.join(output, 'native-state.json'), 'utf8'));
    const login = await fetch(origin + '/playtime/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nova@example.test', password: 'PlayTime-test-123' }),
    });
    const session = await login.json();
    if (!session.token) throw new Error('Fixture receiver login failed');
    const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    const items = [];
    await mkdir(output, { recursive: true });
    for (const message of state.messages) {
        if (message.senderId !== 1 || (!message.voiceStorageKey && !message.attachmentKey))
            continue;
        const plaintext = decryptDmCiphertext(
            message.content,
            new Uint8Array(32).fill(2),
            message.senderDmPublicKey,
            message.receiverDmPublicKey,
            false,
        );
        const descriptor = decodeMediaMessage(plaintext);
        if (!descriptor) throw new Error(`Desktop rejected native descriptor ${message.id}`);
        const kind = descriptor.kind === 'voice' ? 'voice' : 'attachments';
        const response = await fetch(`${origin}/playtime/${kind}/${descriptor.storageKey}`, {
            headers: { Authorization: `Bearer ${session.token}` },
        });
        if (!response.ok) throw new Error('Receiver media download failed');
        const ciphertext = new Uint8Array(await response.arrayBuffer());
        const blob = await mediaBlobForPlayback(
            new Blob([ciphertext]),
            descriptor.mime,
            descriptor,
        );
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (bytes.length !== descriptor.sizeBytes || ciphertext.length !== bytes.length + 16) {
            throw new Error('Native ciphertext/cleartext size mismatch');
        }
        let sourceMatch: boolean | null = null;
        const sourcePath =
            descriptor.filename === 'Retry-encrypted.txt'
                ? path.resolve('mobile/e2e/artifacts/media-corners-final/Retry-encrypted.txt')
                : descriptor.filename === 'Android-gradient.png'
                ? path.resolve('mobile/e2e/artifacts/media-image-final/Android-gradient.png')
                : null;
        if (sourcePath) {
            sourceMatch = sha256(await readFile(sourcePath)) === sha256(bytes);
            if (!sourceMatch) throw new Error('Desktop plaintext differs from native input');
        }
        await writeFile(path.join(output, `${message.id}-${descriptor.filename}`), bytes);
        items.push({
            id: message.id,
            descriptor,
            ciphertextBytes: ciphertext.length,
            plaintextBytes: bytes.length,
            plaintextSha256: sha256(bytes),
            sourceMatch,
        });
    }
    if (!items.some((item) => item.descriptor.kind === 'voice'))
        throw new Error('Missing native voice');
    await writeFile(
        path.join(output, 'consumer-input.json'),
        JSON.stringify({ token: session.token, items }),
        { mode: 0o600 },
    );
    console.log(`Desktop decrypted ${items.length} actual native media messages`);
}
void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
