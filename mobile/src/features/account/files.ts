import { native, isCancelled, pickFile } from '../../platform/device';
import { b64, text, unb64, utf8 } from '../../services/crypto';

export type KeyBackupFile = { name: string; source: string };

export async function selectKeyBackup(): Promise<KeyBackupFile | null> {
    const file = await pickFile('*/*');
    if (!file) {
        return null;
    }
    if (!/\.json$/i.test(file.name)) {
        throw new Error('Выберите резервную копию в формате .json');
    }
    if (file.size > 256000) {
        throw new Error('Файл копии слишком большой. Максимум — 250 КБ.');
    }
    if (!file.base64) {
        throw new Error('Не удалось прочитать файл. Выберите его ещё раз.');
    }
    try {
        const bytes = unb64(file.base64);
        if (bytes.length > 256000) {
            throw new Error('Файл копии слишком большой');
        }
        return { name: file.name, source: text(bytes) };
    } catch {
        throw new Error('Не удалось прочитать копию. Выберите исходный файл JSON.');
    }
}

export async function saveKeyBackup(userId: number, source: string): Promise<boolean> {
    try {
        const uri = await native.saveDocument(
            `playtime-keys-${userId}.json`,
            b64(utf8(source)),
            'application/json',
        );
        return !!uri;
    } catch (error) {
        if (isCancelled(error)) {
            return false;
        }
        throw error;
    }
}
