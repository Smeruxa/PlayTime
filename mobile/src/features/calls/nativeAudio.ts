import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import type { AudioRoute } from './types';
import type { MediaStreamTrack } from 'react-native-webrtc';

type NativeCallBridge = {
    startCallAudio(speaker: boolean): Promise<boolean>;
    stopCallAudio(): Promise<boolean>;
    setSpeakerphone(speaker: boolean): Promise<boolean>;
    startCallRinging?: (incoming: boolean) => Promise<boolean>;
    stopCallRinging?: () => Promise<boolean>;
    systemAudioSupported?: boolean;
    startSystemAudioShare?: (videoTrackId: string) => Promise<{
        screenInfo: ConstructorParameters<typeof MediaStreamTrack>[0];
        microphoneInfo: ConstructorParameters<typeof MediaStreamTrack>[0];
    }>;
    stopSystemAudioShare?: () => Promise<boolean>;
    setAutomaticAudioRecording?: (enabled: boolean) => Promise<boolean>;
    configureScreenCapture?: (
        videoTrackId: string,
        targetLongSide: number,
        maxFps: number,
    ) => Promise<boolean>;
    getAudioRoutes?: () => Promise<AudioRoute[]>;
    selectAudioRoute?: (id: string) => Promise<boolean>;
};
export const native = NativeModules.PlayTimeNative as NativeCallBridge | undefined;

export class MicrophonePermissionError extends Error {
    constructor(public readonly blocked: boolean) {
        super(
            blocked
                ? 'Разрешите доступ к микрофону в настройках Android, затем вернитесь в PlayTime.'
                : 'Для звонка нужен доступ к микрофону. Разрешение можно предоставить при следующей попытке.',
        );
    }
}

export async function requestCallMicrophone(): Promise<void> {
    if (Platform.OS !== 'android') {
        return;
    }
    const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
    if (await PermissionsAndroid.check(permission)) {
        return;
    }
    const result = await PermissionsAndroid.request(permission);
    if (result !== PermissionsAndroid.RESULTS.GRANTED) {
        throw new MicrophonePermissionError(result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
    }
}
