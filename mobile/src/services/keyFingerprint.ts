import { decodeKey } from './crypto';
import { nativeBridge } from './nativeBridge';

export async function keyFingerprint(publicKey: string): Promise<string> {
    decodeKey(publicKey);
    const native = await nativeBridge();
    const digest = await native.sha256Base64(publicKey);
    return digest.match(/.{1,4}/g)?.join(' ') ?? digest;
}
