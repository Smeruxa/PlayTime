import React, { useState } from 'react';
import { Keyboard, ScrollView, Text, View } from 'react-native';
import { confirm } from '../../../platform/device';
import { useApp } from '../../../state/AppContext';
import { useAction } from '../../../state/useAction';
import { Button, Field, Header, Notice } from '../../../ui/components';
import { ui } from '../../../ui/theme';
import { EncryptionKeyDetails } from '../components/EncryptionKeyDetails';
import { saveKeyBackup, selectKeyBackup, type KeyBackupFile } from '../files';

export function KeysBackupScreen({ mode }: { mode: 'backup' | 'restore' }) {
    const { client, state, back } = useApp();
    const action = useAction();
    const [file, setFile] = useState<KeyBackupFile | null>(null);
    const [password, setPassword] = useState('');
    const [repeated, setRepeated] = useState('');
    const [completed, setCompleted] = useState(false);
    const [resetting, setResetting] = useState(false);
    const restore = mode === 'restore';
    const offline = state.connection !== 'online';
    const choose = () => {
        void action.run(async () => {
            const selected = await selectKeyBackup();
            if (selected) {
                setFile(selected);
            }
        });
    };
    const submit = () => {
        if (password.length < 12 || (!restore && password !== repeated)) {
            action.setError(
                password.length < 12
                    ? 'Пароль копии должен содержать не менее 12 символов'
                    : 'Пароли не совпадают',
            );
            return;
        }
        void action.run(async () => {
            if (!state.session) {
                throw new Error('Войдите в аккаунт снова');
            }
            if (restore) {
                if (!file) {
                    throw new Error('Выберите файл резервной копии');
                }
                if (
                    !(await confirm(
                        'Восстановить ключи?',
                        'Ключи из копии заменят ключи этого устройства. Сначала сохраните текущую резервную копию, если здесь есть другая история.',
                        'Восстановить',
                    ))
                ) {
                    return;
                }
                await client.importKeys(file.source, password);
            } else {
                const source = await client.exportKeys(password);
                if (!(await saveKeyBackup(state.session.user.id, source))) {
                    return;
                }
            }
            Keyboard.dismiss();
            setPassword('');
            setRepeated('');
            setFile(null);
            setCompleted(true);
        });
    };
    return (
        <View style={ui.page}>
            <Header
                title={restore ? 'Восстановить ключи' : 'Резервная копия'}
                onBack={back}
            />
            <ScrollView
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                contentContainerStyle={ui.content}
            >
                {completed ? (
                    <>
                        <Notice
                            tone="success"
                            text={
                                restore
                                    ? 'Ключи восстановлены. Переписка снова доступна.'
                                    : 'Копия сохранена. Храните файл и пароль отдельно.'
                            }
                        />
                        <Button
                            title="Готово"
                            onPress={back}
                            testID="keys-done"
                        />
                    </>
                ) : (
                    <>
                        <Text style={ui.muted}>
                            {restore
                                ? 'Выберите сохранённый файл и введите пароль, заданный при создании копии. Пароль аккаунта для этого не подходит.'
                                : 'Зашифрованная копия ключей поможет открыть историю после переустановки PlayTime. Выберите отдельный пароль для файла.'}
                        </Text>
                        {restore ? (
                            <View style={ui.card}>
                                <Text style={ui.label}>Файл .json · до 250 КБ</Text>
                                {file ? (
                                    <Text
                                        style={ui.text}
                                        numberOfLines={3}
                                    >
                                        {file.name}
                                    </Text>
                                ) : null}
                                <Button
                                    title={file ? 'Выбрать другой файл' : 'Выбрать резервную копию'}
                                    icon="file"
                                    variant="secondary"
                                    onPress={choose}
                                    busy={action.busy || resetting}
                                    testID="keys-select-file"
                                />
                            </View>
                        ) : null}
                        <Field
                            label={restore ? 'Пароль от копии' : 'Пароль резервной копии'}
                            secret
                            autoCapitalize="none"
                            autoComplete={restore ? 'off' : 'new-password'}
                            value={password}
                            onChangeText={setPassword}
                            editable={!action.busy && !resetting}
                            hint="Не менее 12 символов"
                            testID="keys-password"
                        />
                        {!restore ? (
                            <Field
                                label="Повторите пароль копии"
                                secret
                                autoCapitalize="none"
                                autoComplete="new-password"
                                value={repeated}
                                onChangeText={setRepeated}
                                editable={!action.busy && !resetting}
                                testID="keys-password-repeat"
                            />
                        ) : null}
                        <Notice
                            text={action.error}
                            tone="error"
                        />
                        <Notice
                            text={
                                offline
                                    ? 'Для работы с ключами нужно подключение к серверу.'
                                    : !restore && !state.encryption.ready
                                    ? 'Сначала восстановите ключи с другого устройства или из копии.'
                                    : null
                            }
                        />
                        <Button
                            title={restore ? 'Восстановить' : 'Сохранить копию'}
                            icon={restore ? 'upload' : 'download'}
                            onPress={submit}
                            busy={action.busy || resetting}
                            disabled={offline || (restore ? !file : !state.encryption.ready)}
                            testID="keys-submit"
                        />
                        <EncryptionKeyDetails
                            disabled={action.busy}
                            onBusyChange={setResetting}
                            onReset={() => {
                                setPassword('');
                                setRepeated('');
                            }}
                        />
                    </>
                )}
            </ScrollView>
        </View>
    );
}
