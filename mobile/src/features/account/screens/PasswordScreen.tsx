import React, { useState } from 'react';
import { Keyboard, ScrollView, Text, View } from 'react-native';
import { confirm } from '../../../platform/device';
import { useApp } from '../../../state/AppContext';
import { useAction } from '../../../state/useAction';
import { passwordError } from '../../../state/validation';
import { Button, Field, Header, Notice } from '../../../ui/components';
import { ui } from '../../../ui/theme';

export function PasswordScreen() {
    const { client, state, back } = useApp();
    const action = useAction();
    const [current, setCurrent] = useState('');
    const [password, setPassword] = useState('');
    const [repeated, setRepeated] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const validation = passwordError(password);
    const mismatch = password !== repeated ? 'Пароли не совпадают' : '';

    const submit = () => {
        setSubmitted(true);
        if (!current || validation || mismatch || action.busy) {
            return;
        }
        void action.run(async () => {
            if (
                !(await confirm(
                    'Сменить пароль?',
                    'После изменения потребуется войти в аккаунт заново.',
                    'Сменить пароль',
                ))
            ) {
                return;
            }
            Keyboard.dismiss();
            await client.changePassword(current, password);
            setCurrent('');
            setPassword('');
            setRepeated('');
        });
    };

    return (
        <View style={ui.page}>
            <Header
                title="Сменить пароль"
                onBack={back}
            />
            <ScrollView
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                contentContainerStyle={ui.content}
            >
                <Text style={ui.muted}>
                    Используйте уникальный пароль. После изменения приложение попросит войти снова.
                </Text>
                <Field
                    label="Текущий пароль"
                    secret
                    autoCapitalize="none"
                    autoComplete="current-password"
                    value={current}
                    onChangeText={setCurrent}
                    editable={!action.busy}
                    testID="password-current"
                    error={submitted && !current ? 'Введите текущий пароль' : undefined}
                />
                <Field
                    label="Новый пароль"
                    secret
                    autoCapitalize="none"
                    autoComplete="new-password"
                    value={password}
                    onChangeText={setPassword}
                    editable={!action.busy}
                    testID="password-new"
                    hint="От 12 до 50 символов"
                    error={submitted ? validation : undefined}
                />
                <Field
                    label="Повторите новый пароль"
                    secret
                    autoCapitalize="none"
                    autoComplete="new-password"
                    value={repeated}
                    onChangeText={setRepeated}
                    editable={!action.busy}
                    testID="password-repeat"
                    returnKeyType="done"
                    onSubmitEditing={submit}
                    error={submitted ? mismatch : undefined}
                />
                <Notice
                    text={action.error}
                    tone="error"
                />
                <Notice
                    text={
                        state.connection !== 'online'
                            ? 'Для изменения пароля нужно подключение к серверу.'
                            : null
                    }
                />
                <Button
                    title="Сменить пароль"
                    icon="lock"
                    onPress={submit}
                    busy={action.busy}
                    disabled={state.connection !== 'online'}
                    testID="password-submit"
                />
            </ScrollView>
        </View>
    );
}
