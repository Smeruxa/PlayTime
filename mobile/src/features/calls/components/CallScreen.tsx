import React, { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CallController } from '../CallController';
import type { CallAvatarMap } from '../types';
import { useCallSnapshot } from '../hooks/useCallSnapshot';
import { durationLabel } from '../durationLabel';
import { CallAction } from './CallAction';
import { Button, IconButton, Notice } from '../../../ui/components';
import { Icon } from '../../../ui/Icon';
import { colors, ui } from '../../../ui/theme';
import { styles } from './styles';
import { CallParticipantCard } from './CallParticipantCard';
import { CallScreenVideo } from './CallScreenVideo';
import { CallVolumeSheet } from './CallVolumeSheet';

export function CallScreen({
    controller,
    onMinimize,
    avatars = {},
    myUserId,
}: {
    controller: CallController;
    onMinimize?: () => void;
    avatars?: CallAvatarMap;
    myUserId?: number;
}) {
    const snapshot = useCallSnapshot(controller);
    const [selectedScreen, setSelectedScreen] = useState<number | 'local' | null>(null);
    const [fullscreen, setFullscreen] = useState(false);
    const [volumeFor, setVolumeFor] = useState<number | 'all' | 'screen' | null>(null);
    const [, tick] = useState(0);
    const { width, height, fontScale } = useWindowDimensions();
    useEffect(() => {
        const timer = setInterval(() => tick((value) => value + 1), 1000);
        return () => clearInterval(timer);
    }, []);
    const call = snapshot.call;
    const screens = [
        ...(snapshot.localScreen
            ? [
                  {
                      id: 'local' as const,
                      username: snapshot.localSystemAudio
                          ? 'Ваш экран · звук приложений'
                          : 'Ваш экран',
                      stream: snapshot.localScreen,
                  },
              ]
            : []),
        ...snapshot.remoteScreens.map((screen) => ({
            id: screen.userId,
            username: screen.username,
            stream: screen.stream,
        })),
    ];
    const screen = screens.find((item) => item.id === selectedScreen) ?? screens[0];
    useEffect(() => {
        if (!screens.length) {
            setFullscreen(false);
        }
    }, [screens.length]);
    if (!call) {
        return null;
    }
    const landscape = width > height;
    const wideActions = fontScale > 1.4 && !landscape;
    const controlsLayout = `${landscape ? 'landscape' : 'portrait'}-${
        fontScale > 1.4 ? 'large' : 'regular'
    }`;
    const subtitle = snapshot.needsResume
        ? 'Нажмите «Подключить звук»'
        : call.phase === 'ringing'
        ? 'Вызываем…'
        : call.phase === 'connecting'
        ? 'Подключаем звук…'
        : call.phase === 'reconnecting'
        ? 'Восстанавливаем соединение…'
        : `${call.context === 'party' ? 'В голосовой комнате' : 'В звонке'}${
              call.startedAt ? ` · ${durationLabel(call.startedAt)}` : ''
          }`;
    const volumeName =
        typeof volumeFor === 'number'
            ? call.participants.find((participant) => participant.userId === volumeFor)?.username ??
              'Участник'
            : volumeFor === 'screen'
            ? 'Звук демонстрации'
            : 'Громкость звонка';
    const volumeValue =
        typeof volumeFor === 'number'
            ? snapshot.participantVolumes[volumeFor] ?? 100
            : volumeFor === 'screen'
            ? snapshot.screenVolume
            : snapshot.masterVolume;
    const changeVolume = (value: number) => {
        if (typeof volumeFor === 'number') {
            controller.setParticipantVolume(volumeFor, value);
        } else if (volumeFor === 'screen') {
            controller.setScreenVolume(value);
        } else {
            controller.setMasterVolume(value);
        }
    };
    const share = () => {
        if (snapshot.localScreen) {
            void controller.stopScreenShare();
            return;
        }
        Alert.alert(
            'Поделиться экраном',
            controller.canShareSystemAudio
                ? 'Android попросит выбрать приложение или весь экран. Для звука других приложений выберите весь экран. Приложения с защищённым содержимым могут запрещать захват звука. Голос передаётся отдельно.'
                : 'Участники увидят выбранное приложение или экран. Android попросит подтверждение. Голос продолжит передаваться через микрофон; звук других приложений недоступен на этой версии Android.',
            [
                { text: 'Отмена', style: 'cancel' },
                { text: 'Только экран', onPress: () => void controller.startScreenShare() },
                ...(controller.canShareSystemAudio
                    ? [
                          {
                              text: 'Экран и звук',
                              onPress: () => void controller.startScreenShare(true),
                          },
                      ]
                    : []),
            ],
        );
    };
    return (
        <View
            testID="call-screen"
            style={ui.page}
        >
            <View style={styles.header}>
                {onMinimize && (
                    <IconButton
                        name="back"
                        label="Свернуть звонок"
                        testID="call-minimize"
                        onPress={onMinimize}
                    />
                )}
                <View style={ui.fill}>
                    <Text style={styles.eyebrow}>
                        PLAYTIME · {call.context === 'party' ? 'КОМНАТА' : 'АУДИОЗВОНОК'}
                    </Text>
                    <Text
                        numberOfLines={1}
                        style={ui.heading}
                    >
                        {call.title}
                    </Text>
                </View>
                <IconButton
                    name="volume"
                    label="Громкость звонка"
                    testID="call-volume"
                    onPress={() => setVolumeFor('all')}
                />
            </View>
            <ScrollView
                contentContainerStyle={[styles.body, landscape && { paddingTop: 8 }]}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.statusRow}>
                    <View
                        style={[
                            styles.statusDot,
                            {
                                backgroundColor:
                                    call.phase === 'connected' ? colors.success : colors.warning,
                            },
                        ]}
                    />
                    <Text
                        testID="call-status"
                        accessibilityLiveRegion="polite"
                        style={ui.muted}
                    >
                        {subtitle}
                    </Text>
                </View>
                {snapshot.interrupted && (
                    <Notice text="Звук приостановлен другим приложением. Он вернётся, когда освободится аудиоканал." />
                )}
                {snapshot.error && (
                    <Notice
                        text={snapshot.error}
                        tone="error"
                        action={
                            snapshot.permissionBlocked ? (
                                <Button
                                    title="Открыть настройки"
                                    variant="secondary"
                                    onPress={() => void controller.openPermissionSettings()}
                                />
                            ) : (
                                <Button
                                    title="Понятно"
                                    variant="ghost"
                                    onPress={() => controller.clearError()}
                                />
                            )
                        }
                    />
                )}
                {snapshot.needsResume && (
                    <Button
                        title="Подключить звук"
                        testID="call-resume"
                        icon="mic"
                        onPress={() => {
                            void controller.resumeMedia().catch(() => {});
                        }}
                    />
                )}
                {screen && (
                    <View style={ui.smallStack}>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Демонстрация на весь экран"
                            testID="call-open-screen"
                            onPress={() => setFullscreen(true)}
                        >
                            <CallScreenVideo screen={screen} />
                        </Pressable>
                        <ScrollView
                            horizontal
                            contentContainerStyle={styles.screenSelector}
                            showsHorizontalScrollIndicator={false}
                        >
                            {screens.map((item) => (
                                <Pressable
                                    key={item.id}
                                    testID={`call-screen-${item.id}`}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Показать демонстрацию: ${item.username}`}
                                    accessibilityState={{ selected: screen.id === item.id }}
                                    onPress={() => setSelectedScreen(item.id)}
                                    style={[
                                        styles.screenChip,
                                        screen.id === item.id && styles.presetSelected,
                                    ]}
                                >
                                    <Text
                                        style={{
                                            color:
                                                screen.id === item.id
                                                    ? colors.accent
                                                    : colors.muted,
                                        }}
                                    >
                                        {item.username}
                                    </Text>
                                </Pressable>
                            ))}
                        </ScrollView>
                        {snapshot.localSystemAudio && snapshot.speaker && (
                            <Text style={ui.caption}>
                                Для чистого звука демонстрации используйте наушники.
                            </Text>
                        )}
                        {screen.id !== 'local' && (
                            <View style={ui.between}>
                                <Button
                                    title={
                                        snapshot.screenAudioMuted
                                            ? 'Включить звук экрана'
                                            : 'Выключить звук экрана'
                                    }
                                    variant="ghost"
                                    onPress={() =>
                                        controller.setScreenAudioMuted(!snapshot.screenAudioMuted)
                                    }
                                />
                                <IconButton
                                    name="volume"
                                    label="Громкость демонстрации"
                                    onPress={() => setVolumeFor('screen')}
                                />
                            </View>
                        )}
                    </View>
                )}
                <View style={[styles.participants, landscape && styles.participantsLandscape]}>
                    {call.participants.map((participant) => (
                        <CallParticipantCard
                            key={participant.userId}
                            participant={participant}
                            visual={avatars[participant.username]}
                            self={participant.userId === myUserId}
                            muted={snapshot.muted}
                            connected={call.phase === 'connected'}
                            volume={snapshot.participantVolumes[participant.userId] ?? 100}
                            count={call.participants.length}
                            compact={landscape}
                            onVolume={() => setVolumeFor(participant.userId)}
                        />
                    ))}
                </View>
                {call.context === 'party' && call.participants.length <= 1 && (
                    <Text style={[ui.muted, { textAlign: 'center' }]}>
                        Вы первым вошли в голосовую комнату. Друзья могут присоединиться из чата.
                    </Text>
                )}
                {snapshot.rttMs != null && (
                    <View style={styles.quality}>
                        <Icon
                            name="wifi"
                            size={16}
                            color={snapshot.rttMs < 150 ? colors.success : colors.warning}
                        />
                        <Text style={ui.caption}>Задержка {snapshot.rttMs} мс</Text>
                    </View>
                )}
            </ScrollView>
            <View
                key={controlsLayout}
                style={[styles.controls, { paddingBottom: 18 }, wideActions && styles.controlsWide]}
            >
                <CallAction
                    wide={wideActions}
                    icon="mic"
                    title={snapshot.muted ? 'Включить микрофон' : 'Выключить микрофон'}
                    selected={snapshot.muted}
                    onPress={() => controller.setMuted(!snapshot.muted)}
                    testID="call-mute"
                />
                <CallAction
                    wide={wideActions}
                    icon="volume"
                    title={snapshot.speaker ? 'Разговорный динамик' : 'Громкая связь'}
                    selected={snapshot.speaker}
                    onPress={() => void controller.setSpeaker(!snapshot.speaker)}
                    testID="call-speaker"
                />
                <CallAction
                    wide={wideActions}
                    icon="monitor"
                    title={snapshot.localScreen ? 'Остановить экран' : 'Показать экран'}
                    selected={!!snapshot.localScreen}
                    disabled={
                        call.phase === 'ringing' || snapshot.sharingBusy || snapshot.needsResume
                    }
                    onPress={share}
                    testID="call-share"
                />
                <CallAction
                    wide={wideActions}
                    icon="phone"
                    title="Завершить"
                    danger
                    onPress={() => controller.end()}
                    testID="call-end"
                />
            </View>
            <Modal
                visible={fullscreen && !!screen}
                onRequestClose={() => setFullscreen(false)}
                animationType="fade"
                supportedOrientations={['portrait', 'landscape']}
                statusBarTranslucent
                navigationBarTranslucent
            >
                <SafeAreaView style={[ui.page, { backgroundColor: '#080808' }]}>
                    <View style={styles.header}>
                        <View style={ui.fill}>
                            <Text
                                numberOfLines={1}
                                style={ui.heading}
                            >
                                {screen?.username}
                            </Text>
                            <Text style={ui.caption}>Демонстрация экрана</Text>
                        </View>
                        <IconButton
                            name="close"
                            label="Закрыть полный экран"
                            testID="call-close-fullscreen"
                            onPress={() => setFullscreen(false)}
                        />
                    </View>
                    {screen && (
                        <CallScreenVideo
                            screen={screen}
                            fullscreen
                        />
                    )}
                    {!landscape && (
                        <View style={{ padding: 16 }}>
                            <Text style={[ui.caption, { textAlign: 'center' }]}>
                                Поверните телефон, чтобы рассмотреть детали.
                            </Text>
                        </View>
                    )}
                </SafeAreaView>
            </Modal>
            <CallVolumeSheet
                controller={controller}
                visible={volumeFor !== null}
                label={volumeName}
                value={volumeValue}
                audioRoutes={volumeFor === 'all'}
                onChange={changeVolume}
                onClose={() => setVolumeFor(null)}
            />
        </View>
    );
}
