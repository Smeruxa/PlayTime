import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Linking, ScrollView, Switch, Text, View } from 'react-native';
import {
    notificationsEnabled,
    setNotificationsEnabled,
} from '../../../platform/notificationPreferences';
import { pushStatusLabel, usePushStatus } from '../../../platform/pushStatus';
import { Button, Header, MenuRow, Notice } from '../../../ui/components';
import { colors, ui } from '../../../ui/theme';
import { useApp } from '../../../state/AppContext';
import { useAudioRecording } from '../../../platform/hooks/useAudioRecording';
import { useAction } from '../../../state/useAction';
import { native, notificationPermission, openLink } from '../../../platform/device';
import { audioPlayback, subscribeAudio } from '../../../platform/audioSession';
import { MicrophoneLevelMeter } from '../components/MicrophoneLevelMeter';

const MICROPHONE_TEST_OWNER = 'microphone-test';

export function SettingsScreen() {
    const { back, calls, state } = useApp();
    const [notifications, setNotifications] = useState(false);
    const playback = useSyncExternalStore(subscribeAudio, audioPlayback.getSnapshot);
    const listening =
        playback.owner === MICROPHONE_TEST_OWNER && (playback.playing || playback.loading);
    const recording = useAudioRecording({
        maxDuration: 10,
        inCall: !!calls?.snapshot.call,
        onSend: async (file) => {
            await audioPlayback.toggle(
                MICROPHONE_TEST_OWNER,
                async () => file.uri,
                (file.durationSec ?? 0) * 1000,
            );
        },
    });
    const testing = recording.recording;
    const action = useAction();
    const userId = state.session?.user.id;
    const pushStatus = usePushStatus();

    useEffect(() => {
        let active = true;
        void (userId ? notificationsEnabled(userId) : Promise.resolve(false)).then((value) => {
            if (active) {
                setNotifications(value);
            }
        });
        return () => {
            active = false;
            void native.cancelVoiceRecording();
            void native.stopAudio();
        };
    }, [userId]);

    const testMicrophone = () => {
        if (recording.recording || recording.pending) {
            return recording.send();
        }
        return recording.start();
    };

    return (
        <View
            style={ui.page}
            testID="settings-screen"
        >
            <Header
                title="Настройки"
                onBack={back}
            />
            <Notice
                text={action.error || recording.error}
                tone="error"
            />
            <ScrollView contentContainerStyle={ui.content}>
                <View style={ui.card}>
                    <Text style={ui.heading}>Звук</Text>
                    <Text style={ui.muted}>
                        Проверьте микрофон: запишите несколько секунд и послушайте, как вас слышно.
                    </Text>
                    <Button
                        title={
                            testing
                                ? 'Остановить и прослушать'
                                : recording.pending
                                ? 'Прослушать запись'
                                : 'Проверить микрофон'
                        }
                        testID="microphone-test"
                        variant={testing ? 'danger' : 'secondary'}
                        busy={recording.busy}
                        disabled={!!calls?.snapshot.call}
                        onPress={() => void testMicrophone()}
                    />
                    {testing && (
                        <View style={ui.smallStack}>
                            <Text style={{ color: colors.danger }}>
                                Идёт запись. Произнесите несколько слов.
                            </Text>
                            <MicrophoneLevelMeter level={recording.level} />
                        </View>
                    )}
                    {listening && <Text style={ui.caption}>Запись воспроизводится.</Text>}
                    {(testing || recording.pending || listening) && (
                        <Button
                            title="Отменить проверку"
                            testID="microphone-test-cancel"
                            variant="ghost"
                            onPress={() => void action.run(recording.cancel)}
                        />
                    )}
                    {!!recording.pending && (
                        <Text style={ui.caption}>Запись готова. Нажмите, чтобы послушать.</Text>
                    )}
                    {!!calls?.snapshot.call && (
                        <Text style={ui.caption}>Проверка доступна после завершения звонка.</Text>
                    )}
                    <Text style={ui.caption}>
                        Динамик, наушники и Bluetooth можно переключать прямо во время звонка.
                    </Text>
                </View>
                <View style={ui.card}>
                    <View style={ui.between}>
                        <View style={ui.fill}>
                            <Text style={ui.heading}>Уведомления</Text>
                            <Text style={ui.caption}>Сообщения и входящие звонки</Text>
                        </View>
                        <Switch
                            testID="notifications-toggle"
                            accessibilityLabel="Уведомления"
                            value={notifications}
                            trackColor={{ true: colors.accentSoft }}
                            thumbColor={notifications ? colors.accent : colors.muted}
                            onValueChange={(enabled) =>
                                void action.run(async () => {
                                    const granted = !enabled || (await notificationPermission());
                                    if (!granted) {
                                        throw new Error(
                                            'Уведомления не разрешены. Их можно включить в настройках Android.',
                                        );
                                    }
                                    setNotifications(enabled);
                                    if (userId) {
                                        await setNotificationsEnabled(userId, enabled);
                                    }
                                })
                            }
                        />
                    </View>
                    <Text
                        style={ui.caption}
                        testID="push-availability"
                    >
                        {pushStatusLabel(pushStatus)}
                    </Text>
                    <MenuRow
                        icon="settings"
                        title="Разрешения Android"
                        description="Микрофон и уведомления"
                        onPress={() => void Linking.openSettings()}
                    />
                </View>
                <View style={ui.card}>
                    <MenuRow
                        icon="chat"
                        title="Связаться с нами"
                        description="Идея, вопрос или сообщение об ошибке"
                        onPress={() =>
                            void action.run(() => openLink('https://smeruxa.ru/playtime/feedback'))
                        }
                    />
                    <MenuRow
                        icon="shield"
                        title="Конфиденциальность"
                        onPress={() =>
                            void action.run(() =>
                                openLink('https://smeruxa.ru/playtime/legal/privacy'),
                            )
                        }
                    />
                    <MenuRow
                        icon="file"
                        title="Условия использования"
                        onPress={() =>
                            void action.run(() =>
                                openLink('https://smeruxa.ru/playtime/legal/terms'),
                            )
                        }
                    />
                </View>
                <Text style={[ui.caption, { textAlign: 'center' }]}>
                    PlayTime · 2.0.15 · Android
                </Text>
            </ScrollView>
        </View>
    );
}
