import { NativeModules } from 'react-native';
import type { LocalMedia } from '../types';

export interface PlayTimeNativeModule {
    readonly version: string;
    addListener(eventName: string): void;
    removeListeners(count: number): void;
    getPushToken(): Promise<{ available: boolean; token: string | null; reason?: string }>;
    reconcilePushAccount(userId: number | null): Promise<boolean>;
    setPushContext(
        userId: number | null,
        enabled: boolean,
        mutedChatKeys: string[],
        activeChatKey: string | null,
    ): Promise<boolean>;
    apiBase: string;
    socketUrl: string;
    pickFile(mime: string): Promise<LocalMedia | null>;
    pickImage(): Promise<(LocalMedia & { dataUri: string }) | null>;
    readFile(uri: string): Promise<string>;
    writeCacheFile(name: string, base64: string, mime: string): Promise<string>;
    deleteCacheFile(uri: string): Promise<boolean>;
    saveDocument(name: string, base64: string, mime: string): Promise<string | null>;
    shareFile(uri: string, mime: string): Promise<boolean>;
    copyText(text: string): Promise<boolean>;
    startVoiceRecording(): Promise<boolean>;
    stopVoiceRecording(): Promise<LocalMedia & { duration: number; durationMs: number }>;
    cancelVoiceRecording(): Promise<boolean>;
    playAudio(uri: string): Promise<boolean>;
    stopAudio(): Promise<boolean>;
    pauseAudio(): Promise<boolean>;
    resumeAudio(): Promise<boolean>;
    seekAudio(positionMs: number): Promise<boolean>;
    getAudioProgress(): Promise<{ positionMs: number; durationMs: number; playing: boolean }>;
    startVoiceRecordingWithLimit(maxSeconds: number): Promise<boolean>;
    sha256Base64(base64: string): Promise<string>;
    showNotification(title: string, text: string, chat: string | null): Promise<boolean>;
    getInitialNotification(): Promise<{ chat: string } | null>;
    getAudioRoutes(): Promise<{ id: string; name: string; type: string }[]>;
    selectAudioRoute(id: string): Promise<boolean>;
    encryptKeyBackup(userId: number, keysJson: string, password: string): Promise<string>;
    decryptKeyBackup(source: string, userId: number, password: string): Promise<string>;
}

export const native = NativeModules.PlayTimeNative as PlayTimeNativeModule;
