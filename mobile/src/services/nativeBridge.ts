export interface PlayTimeNativeBridge {
    apiBase?: string;
    socketUrl?: string;
    encryptKeyBackup(userId: number, keysJson: string, password: string): Promise<string>;
    decryptKeyBackup(source: string, userId: number, password: string): Promise<string>;
    sha256Base64(base64: string): Promise<string>;
    readFile(uri: string): Promise<string>;
    writeCacheFile(name: string, base64: string, mime: string): Promise<string>;
    deleteCacheFile?(uri: string): Promise<void>;
}

export async function nativeBridge(): Promise<PlayTimeNativeBridge> {
    const { NativeModules } = require('react-native') as typeof import('react-native');
    const bridge = NativeModules.PlayTimeNative as PlayTimeNativeBridge | undefined;
    if (!bridge) {
        throw new Error('Модуль Android недоступен. Переустановите приложение.');
    }
    return bridge;
}
