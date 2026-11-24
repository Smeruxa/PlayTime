import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Avatar, Button, Header, IconButton, MenuRow, Notice } from '../../../ui/components';
import { Icon } from '../../../ui/Icon';
import { colors, ui } from '../../../ui/theme';
import { useApp } from '../../../state/AppContext';
import { useAction } from '../../../state/useAction';
import { confirm, publicImage } from '../../../platform/device';
import { native } from '../../../platform/NativePlayTime';

export function ProfileScreen() {
    const { state, client, navigate } = useApp();
    const p = state.profile;
    const action = useAction();
    return (
        <View
            style={ui.page}
            testID="profile-screen"
        >
            <Header
                title="Вы"
                right={
                    <IconButton
                        name="settings"
                        label="Настройки"
                        onPress={() => navigate({ name: 'settings' })}
                    />
                }
            />
            <ScrollView contentContainerStyle={ui.content}>
                <View style={[ui.card, { alignItems: 'center', paddingVertical: 26 }]}>
                    <Avatar
                        size={86}
                        name={state.session?.user.username || ''}
                        uri={publicImage(p?.avatar)}
                        effect={p?.profileAvatarEffect}
                    />
                    <View style={{ alignItems: 'center', gap: 6 }}>
                        <Text style={ui.title}>{state.session?.user.username}</Text>
                        <Text style={ui.muted}>{p?.status || 'Всегда есть о чём поговорить'}</Text>
                    </View>
                    {!!p?.bio && <Text style={[ui.muted, { textAlign: 'center' }]}>{p.bio}</Text>}
                    <Button
                        title="Редактировать профиль"
                        variant="secondary"
                        testID="edit-profile"
                        onPress={() => navigate({ name: 'profileEdit' })}
                    />
                </View>
                <Pressable
                    accessibilityRole="button"
                    onPress={() => navigate({ name: 'plan' })}
                    style={[
                        ui.card,
                        { backgroundColor: colors.accentSoft, borderColor: '#29475D' },
                    ]}
                >
                    <View style={ui.between}>
                        <View style={ui.row}>
                            <Icon
                                name="star"
                                color={colors.accent}
                            />
                            <Text style={ui.heading}>
                                {state.subscription?.limits.displayName || 'PlayTime'}
                            </Text>
                        </View>
                        <Icon
                            name="chevron"
                            size={18}
                            color={colors.accent}
                        />
                    </View>
                    <Text style={ui.muted}>
                        {state.subscription?.limits.userSummary ||
                            'Ваш план и доступные возможности'}
                    </Text>
                </Pressable>
                <View style={ui.card}>
                    <MenuRow
                        icon="shield"
                        title="Аккаунт и безопасность"
                        description="Устройства, пароль и ключи переписки"
                        onPress={() => navigate({ name: 'account' })}
                    />
                    <View style={ui.divider} />
                    <MenuRow
                        icon="settings"
                        title="Настройки"
                        description="Звук, уведомления и разрешения"
                        onPress={() => navigate({ name: 'settings' })}
                    />
                    <View style={ui.divider} />
                    <MenuRow
                        icon="person"
                        title="Заблокированные"
                        description="Управление доступом к общению"
                        onPress={() => navigate({ name: 'blocked' })}
                    />
                </View>
                <Notice
                    text={action.error}
                    tone="error"
                />
                <Button
                    title="Выйти из аккаунта"
                    variant="ghost"
                    icon="logout"
                    busy={action.busy}
                    onPress={() =>
                        void action.run(async () => {
                            if (
                                await confirm(
                                    'Выйти из PlayTime?',
                                    'Ключи переписки сохранятся на этом устройстве.',
                                    'Выйти',
                                )
                            ) {
                                await client.logout();
                            }
                        })
                    }
                />
                <Text style={[ui.caption, { textAlign: 'center' }]}>
                    PlayTime для Android · {native.version}
                </Text>
            </ScrollView>
        </View>
    );
}
