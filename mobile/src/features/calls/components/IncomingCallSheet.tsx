import React from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CallController } from '../CallController';
import type { CallAvatarMap } from '../types';
import { useCallSnapshot } from '../hooks/useCallSnapshot';
import { Avatar, Button, Notice } from '../../../ui/components';
import { ui } from '../../../ui/theme';
import { styles } from './styles';

export function IncomingCallSheet({
    controller,
    avatars = {},
}: {
    controller: CallController;
    avatars?: CallAvatarMap;
}) {
    const snapshot = useCallSnapshot(controller);
    const insets = useSafeAreaInsets();
    const incoming = snapshot.incoming;
    return (
        <Modal
            visible={!!incoming}
            transparent
            animationType="slide"
            onRequestClose={() => {
                void controller.reject().catch(() => {});
            }}
            statusBarTranslucent
            navigationBarTranslucent
        >
            <View style={styles.backdrop}>
                <View
                    style={[styles.sheet, { paddingBottom: Math.max(24, insets.bottom) }]}
                    testID="incoming-call"
                >
                    <ScrollView
                        style={{ flexShrink: 1 }}
                        contentContainerStyle={{ gap: 20 }}
                    >
                        <Text style={styles.eyebrow}>ВХОДЯЩИЙ АУДИОЗВОНОК</Text>
                        <View style={styles.incomingPerson}>
                            <Avatar
                                name={incoming?.from ?? ''}
                                uri={avatars[incoming?.from ?? '']?.avatar}
                                size={84}
                            />
                            <Text style={ui.title}>{incoming?.from}</Text>
                            <Text style={[ui.muted, { textAlign: 'center' }]}>
                                {snapshot.call
                                    ? 'Текущий звонок завершится, если вы ответите.'
                                    : 'Ответьте, чтобы подключиться к разговору.'}
                            </Text>
                        </View>
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
                                ) : undefined
                            }
                        />
                        <View style={styles.incomingActions}>
                            <Button
                                title="Отклонить"
                                icon="close"
                                testID="call-reject"
                                variant="danger"
                                disabled={snapshot.busy}
                                style={ui.fill}
                                onPress={() => {
                                    void controller.reject().catch(() => {});
                                }}
                            />
                            <Button
                                title="Ответить"
                                icon="phone"
                                testID="call-accept"
                                busy={snapshot.busy}
                                style={ui.fill}
                                onPress={() => {
                                    void controller.accept().catch(() => {});
                                }}
                            />
                        </View>
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
}
