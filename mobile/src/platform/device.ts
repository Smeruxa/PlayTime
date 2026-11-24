import { PRODUCTION_ORIGIN } from '../services/storageScope';
import { Alert, Linking, PermissionsAndroid, Platform } from 'react-native';
import type { LocalMedia } from '../types';

export { native } from './NativePlayTime';
import { native } from './NativePlayTime';
export async function microphonePermission(): Promise<boolean> {
    if (Platform.OS !== 'android') {
        return true;
    }
    if (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)) {
        return true;
    }
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
        Alert.alert(
            'Микрофон отключён',
            'Разрешите доступ к микрофону в настройках Android. Переписка доступна и без него.',
            [
                { text: 'Не сейчас', style: 'cancel' },
                {
                    text: 'Настройки',
                    onPress: () => {
                        void Linking.openSettings();
                    },
                },
            ],
        );
    }
    return result === PermissionsAndroid.RESULTS.GRANTED;
}
export async function notificationPermission(): Promise<boolean> {
    if (Platform.OS !== 'android' || Number(Platform.Version) < 33) {
        return true;
    }
    const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
    const result = await PermissionsAndroid.request(permission);
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
        Alert.alert('Уведомления отключены', 'Их можно включить в настройках приложения.', [
            { text: 'Не сейчас', style: 'cancel' },
            {
                text: 'Настройки',
                onPress: () => {
                    void Linking.openSettings();
                },
            },
        ]);
    }
    return result === PermissionsAndroid.RESULTS.GRANTED;
}
export function confirm(
    title: string,
    message: string,
    action = 'Продолжить',
    destructive = false,
): Promise<boolean> {
    return new Promise((resolve) =>
        Alert.alert(
            title,
            message,
            [
                { text: 'Отмена', style: 'cancel', onPress: () => resolve(false) },
                {
                    text: action,
                    style: destructive ? 'destructive' : 'default',
                    onPress: () => resolve(true),
                },
            ],
            { cancelable: true, onDismiss: () => resolve(false) },
        ),
    );
}
export function isCancelled(error: unknown): boolean {
    return /cancel|отмен/i.test(error instanceof Error ? error.message : String(error));
}
export async function pickFile(mime = '*/*'): Promise<LocalMedia | null> {
    try {
        return await native.pickFile(mime);
    } catch (error) {
        if (isCancelled(error)) {
            return null;
        }
        throw error;
    }
}
export async function pickImage(): Promise<(LocalMedia & { dataUri: string }) | null> {
    try {
        return await native.pickImage();
    } catch (error) {
        if (isCancelled(error)) {
            return null;
        }
        throw error;
    }
}
export function publicImage(value?: string | null): string | undefined {
    if (!value) {
        return undefined;
    }
    if (/^(https?:|data:|file:|content:)/.test(value)) {
        return value;
    }
    return `${PRODUCTION_ORIGIN}${value.startsWith('/') ? '' : '/'}${value}`;
}
export async function openLink(url: string) {
    if (!/^https:\/\//i.test(url)) {
        throw new Error('Можно открывать только защищённые HTTPS-ссылки');
    }
    await Linking.openURL(url);
}
