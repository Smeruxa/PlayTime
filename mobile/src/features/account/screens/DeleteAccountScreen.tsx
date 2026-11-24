import React, { useState } from 'react';
import { Keyboard, ScrollView, Text, View } from 'react-native';
import { confirm } from '../../../platform/device';
import { useApp } from '../../../state/AppContext';
import { useAction } from '../../../state/useAction';
import { Button, Field, Header, Notice } from '../../../ui/components';
import { ui } from '../../../ui/theme';
import { HoldDeleteButton } from '../components/HoldDeleteButton';

export function DeleteAccountScreen() {
    const { client, state, back } = useApp();
    const action = useAction();
    const [password, setPassword] = useState('');
    const [armed, setArmed] = useState(false);
    const offline = state.connection !== 'online';
    const prepare = () => {
        void action.run(async () => {
            if (
                await confirm(
                    'Удалить аккаунт?',
                    'Профиль, контакты и доступ к переписке будут удалены. Вернуть аккаунт будет невозможно.',
                    'Продолжить удаление',
                    true,
                )
            ) {
                Keyboard.dismiss();
                setArmed(true);
            }
        });
    };
    const remove = () => {
        if (!armed || !password || offline) {
            return;
        }
        setArmed(false);
        void action.run(async () => {
            await client.deleteAccount(password);
            setPassword('');
        });
    };
    return (
        <View style={ui.page}>
            <Header
                title="Удалить аккаунт"
                onBack={back}
            />
            <ScrollView
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                contentContainerStyle={ui.content}
            >
                <View style={ui.card}>
                    <Text style={ui.heading}>Это действие необратимо</Text>
                    <Text style={ui.muted}>
                        Аккаунт {state.session?.user.username} будет удалён. Вы потеряете профиль,
                        контакты и доступ к переписке. Отменить удаление или восстановить аккаунт не
                        получится.
                    </Text>
                </View>
                <Field
                    label="Подтвердите паролем аккаунта"
                    secret
                    autoCapitalize="none"
                    autoComplete="current-password"
                    value={password}
                    onChangeText={setPassword}
                    editable={!action.busy && !armed}
                    testID="delete-password"
                />
                <Notice
                    tone="error"
                    text={action.error}
                />
                <Notice text={offline ? 'Для удаления нужно подключение к серверу.' : null} />
                {armed ? (
                    <>
                        <Notice text="Удерживайте кнопку три секунды. Если передумаете, отпустите её до завершения отсчёта." />
                        <HoldDeleteButton
                            disabled={action.busy || offline}
                            onComplete={remove}
                        />
                        <Button
                            title="Отменить удаление"
                            variant="secondary"
                            onPress={() => setArmed(false)}
                            disabled={action.busy}
                        />
                    </>
                ) : (
                    <Button
                        title="Продолжить удаление"
                        variant="danger"
                        icon="trash"
                        disabled={!password || offline}
                        busy={action.busy}
                        onPress={prepare}
                        testID="delete-prepare"
                    />
                )}
            </ScrollView>
        </View>
    );
}
