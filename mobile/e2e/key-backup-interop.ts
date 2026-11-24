import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import { decryptKeyBackup, encryptKeyBackup } from '../../apps/frontend/src/features/chat/keyBackup';

async function main() {
    const [sourcePath, wrongAccountPath] = process.argv.slice(2);
    if (!sourcePath || !wrongAccountPath) {
        throw new Error('Expected native backup input and wrong-account output paths');
    }
    const password = 'Backup-Android-123';
    const source = await readFile(sourcePath, 'utf8');
    const keys = await decryptKeyBackup(source, 1, password);
    const publicKey = nacl.box.keyPair.fromSecretKey(util.decodeBase64(keys.dm)).publicKey;
    const fingerprint = createHash('sha256')
        .update(publicKey)
        .digest('hex')
        .match(/.{4}/g)!
        .join(' ');
    const wrongAccount = await encryptKeyBackup(2, keys, password);
    await writeFile(wrongAccountPath, wrongAccount, { mode: 0o600 });
    process.stdout.write(
        JSON.stringify({
            desktopDecryptedNativeBackup: true,
            keyCount: Object.keys(keys).length,
            publicKey: util.encodeBase64(publicKey),
            fingerprint,
        }),
    );
}

void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Backup interop failed');
    process.exitCode = 1;
});
