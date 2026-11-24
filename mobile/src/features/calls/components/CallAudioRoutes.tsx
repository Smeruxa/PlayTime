import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Button } from '../../../ui/components';
import { ui } from '../../../ui/theme';
import type { CallController } from '../CallController';
import type { AudioRoute } from '../types';
import { useCallSnapshot } from '../hooks/useCallSnapshot';

export function CallAudioRoutes({ controller }: { controller: CallController }) {
    const { bluetoothPermission } = useCallSnapshot(controller);
    const [routes, setRoutes] = useState<AudioRoute[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const open = async () => {
        setBusy(true);
        setMessage('');
        try {
            setRoutes(await controller.getAudioRoutes());
        } catch {
            setMessage('Не удалось получить список устройств. Проверьте подключение наушников.');
        } finally {
            setBusy(false);
        }
    };
    const select = async (route: AudioRoute) => {
        setBusy(true);
        try {
            await controller.selectAudioRoute(route);
            setMessage(`Выбрано: ${route.name}`);
            setRoutes(null);
        } catch {
            setMessage('Не удалось переключить звук. Подключите устройство снова.');
        } finally {
            setBusy(false);
        }
    };
    return (
        <View style={ui.smallStack}>
            <Button
                title="Наушники и динамики"
                testID="call-audio-routes"
                variant="secondary"
                icon="volume"
                busy={busy}
                onPress={() => {
                    void open();
                }}
            />
            {bluetoothPermission && (
                <Text style={ui.caption}>
                    Bluetooth недоступен без разрешения. Динамик и разговорный громкоговоритель
                    можно использовать и без него.
                </Text>
            )}
            {bluetoothPermission === 'blocked' && (
                <Button
                    title="Открыть настройки Bluetooth"
                    variant="secondary"
                    onPress={() => void controller.openPermissionSettings()}
                />
            )}
            {routes?.map((route) => (
                <Button
                    key={route.id}
                    title={route.name}
                    disabled={busy}
                    variant="ghost"
                    onPress={() => {
                        void select(route);
                    }}
                />
            ))}
            {routes?.length === 0 && (
                <Text style={ui.caption}>
                    Другие устройства не подключены. Используйте кнопку громкой связи.
                </Text>
            )}
            {!!message && (
                <Text
                    style={ui.caption}
                    accessibilityLiveRegion="polite"
                >
                    {message}
                </Text>
            )}
        </View>
    );
}
