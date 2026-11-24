import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { CallController } from '../CallController';
import { useCallSnapshot } from '../hooks/useCallSnapshot';
import { Icon } from '../../../ui/Icon';
import { colors, ui } from '../../../ui/theme';
import { styles } from './styles';
import { Button, Notice } from '../../../ui/components';

export function ActiveCallBar({
    controller,
    onPress,
}: {
    controller: CallController;
    onPress: () => void;
}) {
    const snapshot = useCallSnapshot(controller);
    if (snapshot.ongoingElsewhere && !snapshot.call) {
        return (
            <View
                testID="call-ongoing-elsewhere"
                style={[styles.callBar, { flexDirection: 'column', alignItems: 'stretch' }]}
            >
                <Text style={ui.text}>
                    {snapshot.ongoingElsewhere.status === 'request_receiver'
                        ? 'Вызов выполняется на другом устройстве'
                        : 'Звонок продолжается на другом устройстве'}
                </Text>
                <Text style={ui.caption}>
                    {snapshot.ongoingElsewhere.status === 'request_receiver'
                        ? 'Дождитесь ответа собеседника, чтобы перенести звонок сюда.'
                        : snapshot.ongoingElsewhere.media?.canClaim
                        ? 'Продолжите здесь, чтобы перенести звук на этот телефон.'
                        : 'Обновите PlayTime на другом устройстве, чтобы перенести звонок.'}
                </Text>
                <Button
                    title="Продолжить звонок здесь"
                    testID="call-claim"
                    busy={snapshot.busy}
                    disabled={!snapshot.ongoingElsewhere.media?.canClaim}
                    onPress={() => {
                        void controller.claim().catch(() => {});
                    }}
                />
                <Notice
                    text={snapshot.error}
                    tone="error"
                />
            </View>
        );
    }
    if (!snapshot.call) {
        return null;
    }
    return (
        <Pressable
            testID="active-call-bar"
            accessibilityRole="button"
            accessibilityLabel="Вернуться в звонок"
            onPress={onPress}
            style={styles.callBar}
        >
            <Icon
                name="phone"
                size={18}
                color={colors.success}
            />
            <View style={ui.fill}>
                <Text
                    numberOfLines={1}
                    style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}
                >
                    {snapshot.call.title}
                </Text>
                <Text style={ui.caption}>
                    {snapshot.call.phase === 'ringing'
                        ? 'Вызываем…'
                        : 'Нажмите, чтобы вернуться в звонок'}
                </Text>
            </View>
            {snapshot.muted && (
                <Icon
                    name="mic"
                    size={18}
                    color={colors.warning}
                />
            )}
            <Icon
                name="chevron"
                size={18}
                color={colors.success}
            />
        </Pressable>
    );
}
