import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button, Header, Notice } from '../../../ui/components';
import { Icon } from '../../../ui/Icon';
import { colors, ui } from '../../../ui/theme';
import { useApp } from '../../../state/AppContext';
import { useAction } from '../../../state/useAction';
import { formatBytes } from '../../../state/validation';
import { openLink } from '../../../platform/device';

export function PlanScreen() {
    const { state, back } = useApp();
    const action = useAction();
    const limits = state.subscription?.limits;
    const rows = limits
        ? [
              ['Участников в комнате', String(limits.maxRoomMembers)],
              ['Участников в голосовом чате', String(limits.maxPartySockets)],
              ['Вложения', `до ${formatBytes(limits.maxAttachmentBytes)}`],
              ['Голосовые сообщения', `до ${limits.maxVoiceMessageSec} секунд`],
              ['Демонстрация экрана', `${limits.maxScreenBroadcastFps} кадров/с`],
              ['Баннер профиля', limits.profileBannerAllowed ? 'Доступен' : 'В расширенном плане'],
              ['Эффекты профиля', limits.avatarEffectsAllowed ? 'Доступны' : 'Базовые'],
          ]
        : [];
    return (
        <View
            style={ui.page}
            testID="plan-screen"
        >
            <Header
                title="Ваш план"
                onBack={back}
            />
            <ScrollView contentContainerStyle={ui.content}>
                <View style={[ui.card, { backgroundColor: colors.accentSoft }]}>
                    <Icon
                        name="star"
                        size={36}
                        color={colors.accent}
                    />
                    <Text style={ui.title}>{limits?.displayName || 'PlayTime'}</Text>
                    <Text style={ui.muted}>
                        {limits?.userSummary || 'Загружаем условия вашего плана…'}
                    </Text>
                </View>
                <View style={ui.card}>
                    {rows.map(([name, value]) => (
                        <View
                            key={name}
                            style={ui.between}
                        >
                            <Text style={[ui.muted, ui.fill]}>{name}</Text>
                            <Text style={[ui.text, { flexShrink: 1, textAlign: 'right' }]}>
                                {value}
                            </Text>
                        </View>
                    ))}
                </View>
                <Button
                    title="Узнать о возможностях"
                    variant="secondary"
                    onPress={() => void action.run(() => openLink('https://smeruxa.ru/playtime/'))}
                />
                <Notice
                    text={action.error}
                    tone="error"
                />
            </ScrollView>
        </View>
    );
}
