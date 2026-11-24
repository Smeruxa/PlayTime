import type { LocalMedia, MediaDescriptor } from '../types';
import {
    b64,
    unb64,
    randomId,
    encryptMediaBytes,
    decryptMediaBytes,
    imageMimeMatches,
    safeMime,
} from './crypto';
import { ApiError } from './http';
import { nativeBridge } from './nativeBridge';

export type MediaContext = {
    apiBase: string;
    token: string;
    fetcher: typeof fetch;
    maxAttachmentBytes: number;
    maxVoiceMessageSec: number;
    isCurrent: () => boolean;
};

export async function uploadEncryptedMedia(
    file: LocalMedia,
    kind: 'voice' | 'attachment',
    context: MediaContext,
): Promise<MediaDescriptor> {
    const max = kind === 'voice' ? 6 * 1024 * 1024 : context.maxAttachmentBytes;
    if (file.size <= 0 || file.size > max) {
        throw new Error(`Файл должен быть не больше ${Math.floor(max / 1024 / 1024)} МБ`);
    }
    if (
        kind === 'voice' &&
        (!file.durationSec ||
            file.durationSec <= 0 ||
            file.durationSec > context.maxVoiceMessageSec)
    ) {
        throw new Error(`Голосовое сообщение: до ${context.maxVoiceMessageSec} секунд`);
    }

    const native = await nativeBridge();
    const bytes = unb64(file.base64 ?? (await native.readFile(file.uri)));
    if (bytes.length !== file.size || bytes.length > max) {
        throw new Error('Размер файла изменился. Выберите файл заново.');
    }
    const encrypted = encryptMediaBytes(bytes);
    const uri = await native.writeCacheFile(
        `${randomId()}.bin`,
        b64(encrypted.bytes),
        'application/octet-stream',
    );
    const form = new FormData();
    form.append('file', {
        uri,
        type: 'application/octet-stream',
        name: 'encrypted.bin',
    } as unknown as Blob);
    if (kind === 'voice') {
        form.append('durationSec', String(file.durationSec));
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
        const response = await context.fetcher(
            `${context.apiBase}/${kind === 'voice' ? 'voice' : 'attachments'}/upload`,
            {
                method: 'POST',
                headers: { Authorization: `Bearer ${context.token}` },
                body: form,
                signal: controller.signal,
            },
        );
        const result = (await response.json()) as {
            error?: string;
            voiceKey?: string;
            attachmentKey?: string;
        };
        if (!response.ok) {
            throw new ApiError(result.error ?? 'Не удалось загрузить файл', response.status);
        }
        if (!context.isCurrent()) {
            throw new Error('Аккаунт изменился');
        }
        const storageKey = kind === 'voice' ? result.voiceKey : result.attachmentKey;
        if (!storageKey || !/^[a-f0-9-]{36}$/.test(storageKey)) {
            throw new Error('Сервер не подтвердил загрузку файла');
        }
        return {
            kind,
            storageKey,
            key: encrypted.key,
            nonce: encrypted.nonce,
            mime: safeMime(file.mime),
            filename: file.name.slice(0, 200),
            sizeBytes: bytes.length,
            ...(kind === 'voice' ? { durationSec: file.durationSec } : {}),
        };
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error('Загрузка заняла слишком много времени. Повторите попытку.');
        }
        if (error instanceof TypeError) {
            throw new Error('Не удалось передать файл. Проверьте интернет и повторите попытку.');
        }
        throw error;
    } finally {
        clearTimeout(timeout);
        if (native.deleteCacheFile) {
            void native.deleteCacheFile(uri).catch(() => {});
        }
    }
}

export async function downloadEncryptedMedia(
    descriptor: MediaDescriptor,
    context: MediaContext,
): Promise<string> {
    if (!/^[a-f0-9-]{36}$/.test(descriptor.storageKey)) {
        throw new Error('Некорректное вложение');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
        const response = await context.fetcher(
            `${context.apiBase}/${descriptor.kind === 'voice' ? 'voice' : 'attachments'}/${
                descriptor.storageKey
            }`,
            { headers: { Authorization: `Bearer ${context.token}` }, signal: controller.signal },
        );
        if (!response.ok) {
            throw new Error(
                response.status === 404
                    ? 'Вложение удалено или недоступно'
                    : 'Не удалось загрузить вложение',
            );
        }
        const declared = Number(response.headers.get('content-length'));
        if (declared > 12 * 1024 * 1024 + 16) {
            throw new Error('Вложение превышает допустимый размер');
        }
        const bytes = decryptMediaBytes(new Uint8Array(await response.arrayBuffer()), descriptor);
        if (!imageMimeMatches(bytes, descriptor.mime)) {
            throw new Error('Формат изображения не соответствует файлу');
        }
        if (!context.isCurrent()) {
            throw new Error('Аккаунт изменился');
        }
        const native = await nativeBridge();
        return native.writeCacheFile(
            `${randomId()}-${descriptor.filename}`,
            b64(bytes),
            descriptor.mime,
        );
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error('Загрузка заняла слишком много времени. Повторите попытку.');
        }
        if (error instanceof TypeError) {
            throw new Error('Не удалось передать файл. Проверьте интернет и повторите попытку.');
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}
