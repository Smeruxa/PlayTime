import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import type { MediaDescriptor } from '../types';

export const DM_PREFIX = 'E2E1:';
export const ROOM_PREFIX = 'R2E1:';
export const MEDIA_PREFIX = 'PTMEDIA1:';
export const LOCKED_MESSAGE = '🔒 Ключ переписки недоступен. Восстановите его в профиле.';
export const b64 = util.encodeBase64;
export const unb64 = util.decodeBase64;
export const utf8 = util.decodeUTF8;
export const text = util.encodeUTF8;

export function randomId(): string {
    const bytes = nacl.randomBytes(16);
    bytes[6] = (bytes[6] % 16) + 64;
    bytes[8] = (bytes[8] % 64) + 128;
    const hex = Array.from(bytes, (v) => v.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
        16,
        20,
    )}-${hex.slice(20)}`;
}

export function decodeKey(value: string): Uint8Array {
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
        throw new Error('Некорректный ключ шифрования');
    }
    const bytes = unb64(value);
    if (bytes.length !== 32) {
        throw new Error('Некорректный ключ шифрования');
    }
    return bytes;
}

export function validateBackupKeys(keys: unknown): asserts keys is Record<string, string> {
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
        throw new Error('Некорректная копия ключей');
    }
    const entries = Object.entries(keys);
    if (entries.length > 2000 || !('dm' in keys)) {
        throw new Error('В копии нет ключа переписки');
    }
    for (const [name, value] of entries) {
        if (!/^(dm|room:[1-9]\d*(?::[1-9]\d*)?)$/.test(name) || typeof value !== 'string') {
            throw new Error('Некорректная копия ключей');
        }
        decodeKey(value);
    }
}

export function publicKey(secret: string): string {
    return b64(nacl.box.keyPair.fromSecretKey(decodeKey(secret)).publicKey);
}

export function encryptDmBytes(plain: Uint8Array, peer: string, secret: string): string {
    const nonce = nacl.randomBytes(24);
    return (
        DM_PREFIX +
        JSON.stringify({
            n: b64(nonce),
            b: b64(nacl.box(plain, nonce, decodeKey(peer), decodeKey(secret))),
        })
    );
}

export function encryptDm(plain: string, peer: string, secret: string): string {
    return encryptDmBytes(utf8(plain), peer, secret);
}

function parseEnvelope(stored: string, prefix: string): { nonce: Uint8Array; boxed: Uint8Array } {
    if (!stored.startsWith(prefix) || stored.length > 60000) {
        throw new Error('Некорректное шифрование');
    }
    const wire: unknown = JSON.parse(stored.slice(prefix.length));
    if (
        !wire ||
        typeof wire !== 'object' ||
        !('n' in wire) ||
        !('b' in wire) ||
        typeof wire.n !== 'string' ||
        typeof wire.b !== 'string'
    ) {
        throw new Error('Некорректное шифрование');
    }
    const nonce = unb64(wire.n);
    const boxed = unb64(wire.b);
    if (nonce.length !== 24 || boxed.length < 16) {
        throw new Error('Некорректное шифрование');
    }
    return { nonce, boxed };
}

export function decryptDmBytes(stored: string, peer: string, secret: string): Uint8Array {
    const { nonce, boxed } = parseEnvelope(stored, DM_PREFIX);
    const opened = nacl.box.open(boxed, nonce, decodeKey(peer), decodeKey(secret));
    if (!opened) {
        throw new Error('Не удалось расшифровать сообщение');
    }
    return opened;
}

export function decryptDm(stored: string, peer: string, secret: string): string {
    return text(decryptDmBytes(stored, peer, secret));
}

export function roomEpoch(content: string): number {
    if (!content.startsWith(ROOM_PREFIX)) {
        return 0;
    }
    try {
        const epoch = JSON.parse(content.slice(ROOM_PREFIX.length)).e ?? 0;
        return Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : -1;
    } catch {
        return -1;
    }
}

export function roomKeyName(roomId: number, epoch: number): string {
    return epoch ? `room:${roomId}:${epoch}` : `room:${roomId}`;
}

export type RoomKey = { epoch: number; key: string };

export function encryptRoom(plain: string, key: string, epoch = 0): string {
    const nonce = nacl.randomBytes(24);
    return (
        ROOM_PREFIX +
        JSON.stringify({
            e: epoch,
            n: b64(nonce),
            b: b64(nacl.secretbox(utf8(plain), nonce, decodeKey(key))),
        })
    );
}

export function decryptRoom(stored: string, key: string): string {
    const { nonce, boxed } = parseEnvelope(stored, ROOM_PREFIX);
    const opened = nacl.secretbox.open(boxed, nonce, decodeKey(key));
    if (!opened) {
        throw new Error('Не удалось расшифровать сообщение');
    }
    return text(opened);
}

const SAFE_MIMES = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/octet-stream',
    'application/pdf',
    'application/zip',
    'text/plain',
    'audio/webm',
    'audio/ogg',
    'audio/mp4',
    'audio/mpeg',
]);
export const safeMime = (mime: string): string => {
    const normalized = mime.split(';')[0].trim().toLowerCase();
    return SAFE_MIMES.has(normalized) ? normalized : 'application/octet-stream';
};
export function parseMedia(content: string): MediaDescriptor | null {
    if (!content.startsWith(MEDIA_PREFIX) || content.length > 2000) {
        return null;
    }
    try {
        const d = JSON.parse(content.slice(MEDIA_PREFIX.length)) as MediaDescriptor;
        if (
            !d ||
            !['voice', 'attachment'].includes(d.kind) ||
            typeof d.storageKey !== 'string' ||
            !/^[a-f0-9-]{36}$/.test(d.storageKey) ||
            typeof d.key !== 'string' ||
            typeof d.nonce !== 'string' ||
            typeof d.mime !== 'string' ||
            typeof d.filename !== 'string' ||
            d.filename.length > 200 ||
            !Number.isSafeInteger(d.sizeBytes) ||
            d.sizeBytes < 0 ||
            d.sizeBytes > 12 * 1024 * 1024 ||
            (d.kind === 'voice' &&
                (!Number.isFinite(d.durationSec) ||
                    Number(d.durationSec) <= 0 ||
                    Number(d.durationSec) > 3600))
        ) {
            return null;
        }
        decodeKey(d.key);
        if (unb64(d.nonce).length !== 24) {
            return null;
        }
        return {
            ...d,
            mime: safeMime(d.mime),
            filename: Array.from(d.filename, (character) =>
                character.charCodeAt(0) < 32 ||
                character.charCodeAt(0) === 127 ||
                character === '/' ||
                character === '\\'
                    ? '_'
                    : character,
            ).join(''),
        };
    } catch {
        return null;
    }
}

export function encryptMediaBytes(bytes: Uint8Array): {
    bytes: Uint8Array;
    key: string;
    nonce: string;
} {
    const key = nacl.randomBytes(32);
    const nonce = nacl.randomBytes(24);
    return { bytes: nacl.secretbox(bytes, nonce, key), key: b64(key), nonce: b64(nonce) };
}

export function decryptMediaBytes(bytes: Uint8Array, descriptor: MediaDescriptor): Uint8Array {
    if (bytes.length > 12 * 1024 * 1024 + 16) {
        throw new Error('Вложение превышает допустимый размер');
    }
    const opened = nacl.secretbox.open(bytes, unb64(descriptor.nonce), decodeKey(descriptor.key));
    if (!opened || opened.length !== descriptor.sizeBytes) {
        throw new Error('Не удалось расшифровать вложение');
    }
    return opened;
}

export function imageMimeMatches(bytes: Uint8Array, mime: string): boolean {
    const starts = (values: number[]) => values.every((v, i) => bytes[i] === v);
    if (mime === 'image/png') {
        return starts([137, 80, 78, 71, 13, 10, 26, 10]);
    }
    if (mime === 'image/jpeg') {
        return starts([255, 216, 255]);
    }
    if (mime === 'image/gif') {
        return starts([71, 73, 70, 56]) && [55, 57].includes(bytes[4]) && bytes[5] === 97;
    }
    if (mime === 'image/webp') {
        return starts([82, 73, 70, 70]) && [87, 69, 66, 80].every((v, i) => bytes[i + 8] === v);
    }
    return !mime.startsWith('image/');
}

export function createTransferPayload(userId: number, keys: Record<string, string>) {
    validateBackupKeys(keys);
    const secret = nacl.randomBytes(32);
    const nonce = nacl.randomBytes(24);
    return {
        secret: b64(secret),
        nonce: b64(nonce),
        ciphertext: b64(nacl.secretbox(utf8(JSON.stringify({ userId, keys })), nonce, secret)),
    };
}

export function openTransferPayload(
    userId: number,
    secret: string,
    nonce: string,
    ciphertext: string,
): Record<string, string> {
    if (ciphertext.length > 24000) {
        throw new Error('Некорректный пакет ключей');
    }
    const opened = nacl.secretbox.open(unb64(ciphertext), unb64(nonce), decodeKey(secret));
    if (!opened) {
        throw new Error('Не удалось расшифровать ключи. Создайте новый код на первом устройстве.');
    }
    const value = JSON.parse(text(opened));
    if (value.userId !== userId) {
        throw new Error('Ключи принадлежат другому аккаунту');
    }
    validateBackupKeys(value.keys);
    return value.keys;
}
