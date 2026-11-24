import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useApp } from '../../../state/AppContext';
import { Header, MenuRow, Notice, SectionLabel } from '../../../ui/components';
import { ui } from '../../../ui/theme';

export function AccountScreen() {
    const { state, navigate, back } = useApp();
    return (
        <View style={ui.page}>
            <Header
                title="Аккаунт и безопасность"
                onBack={back}
            />
            <ScrollView contentContainerStyle={ui.content}>
                <View style={ui.card}>
                    <Text style={ui.heading}>{state.session?.user.username}</Text>
                    <Text
                        selectable
                        style={ui.muted}
                    >
                        {state.session?.user.email}
                    </Text>
                </View>
                <Notice
                    tone={state.encryption.needsRecovery ? 'error' : 'info'}
                    text={
                        state.encryption.needsRecovery
                            ? 'Восстановите ключи с другого устройства или из резервной копии, чтобы открыть зашифрованную историю.'
                            : 'Ключи переписки хранятся на ваших устройствах. Сохраните копию перед переустановкой приложения.'
                    }
                />
                <View>
                    <SectionLabel>Вход в аккаунт</SectionLabel>
                    <MenuRow
                        icon="monitor"
                        title="Устройства и сеансы"
                        description="Проверить входы и отключить устройства"
                        testID="account-sessions"
                        onPress={() => navigate({ name: 'sessions' })}
                    />
                    <MenuRow
                        icon="lock"
                        title="Сменить пароль"
                        description="Для следующего входа понадобится новый пароль"
                        testID="account-password"
                        onPress={() => navigate({ name: 'password' })}
                    />
                </View>
                <View>
                    <SectionLabel>Ключи переписки</SectionLabel>
                    <MenuRow
                        icon="phone"
                        title="Перенести на устройство"
                        description="Одноразовый защищённый код"
                        testID="account-transfer"
                        onPress={() => navigate({ name: 'transfer' })}
                    />
                    <MenuRow
                        icon="download"
                        title="Сохранить резервную копию"
                        description="Зашифрованный файл с отдельным паролем"
                        testID="account-backup"
                        onPress={() => navigate({ name: 'backup' })}
                    />
                    <MenuRow
                        icon="upload"
                        title="Восстановить из копии"
                        description="Вернуть доступ к истории переписки"
                        testID="account-restore"
                        onPress={() => navigate({ name: 'restore' })}
                    />
                </View>
                <View style={ui.divider} />
                <MenuRow
                    icon="trash"
                    title="Удалить аккаунт"
                    description="Необратимо удалить профиль и данные"
                    danger
                    testID="account-delete"
                    onPress={() => navigate({ name: 'deleteAccount' })}
                />
            </ScrollView>
        </View>
    );
}
