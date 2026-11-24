import React, { useEffect, useState } from 'react';
import { Keyboard, ScrollView, Text, View } from 'react-native';
import { confirm, native } from '../../../platform/device';
import { useApp } from '../../../state/AppContext';
import { useAction } from '../../../state/useAction';
import { Button, ChoiceChips, Field, Header, Notice } from '../../../ui/components';
import { ui } from '../../../ui/theme';
import { useSecondClock } from '../hooks/useSecondClock';

type TransferCode = { code: string; expiresAt: number };

export function KeyTransferScreen() {
    const { client, state, back } = useApp();
    const action = useAction();
    const copyAction = useAction();
    const [mode, setMode] = useState<'send' | 'receive'>(
        state.encryption.needsRecovery ? 'receive' : 'send',
    );
    const [transfer, setTransfer] = useState<TransferCode | null>(null);
    const [code, setCode] = useState('');
    const [completed, setCompleted] = useState(false);
    const now = useSecondClock(!!transfer);
    const remaining = Math.max(0, Math.ceil(((transfer?.expiresAt || 0) - now) / 1000));
    const expired = !!transfer && remaining === 0;
    const offline = state.connection !== 'online';
    useEffect(() => {
        if (expired && transfer?.code) {
            setTransfer({ ...transfer, code: '' });
        }
    }, [expired, transfer]);

    const create = () => {
        void action.run(async () => {
            const result = await client.createKeyTransfer();
            if (
                !result.code ||
                !Number.isFinite(result.expiresAt) ||
                result.expiresAt <= Date.now()
            ) {
                throw new Error('Не удалось создать действующий код. Повторите попытку.');
            }
            setTransfer(result);
            copyAction.setSuccess('');
        });
    };
    const receive = () => {
        if (!code.trim()) {
            action.setError('Вставьте полный код с первого устройства');
            return;
        }
        void action.run(async () => {
            if (
                !(await confirm(
                    'Перенести ключи на этот телефон?',
                    'Ключи этого устройства будут заменены. Код с первого устройства станет недействительным после использования.',
                    'Перенести ключи',
                ))
            ) {
                return;
            }
            await client.consumeKeyTransfer(code.trim());
            Keyboard.dismiss();
            setCode('');
            setCompleted(true);
        });
    };
    const changeMode = (value: 'send' | 'receive') => {
        if (!action.busy) {
            setMode(value);
            action.setError('');
            copyAction.setSuccess('');
        }
    };

    return (
        <View style={ui.page}>
            <Header
                title="Перенести ключи"
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
                            text="Ключи перенесены. Теперь на этом телефоне доступна зашифрованная переписка."
                            tone="success"
                        />
                        <Button
                            title="Готово"
                            onPress={back}
                            testID="transfer-done"
                        />
                    </>
                ) : (
                    <>
                        <ChoiceChips
                            value={mode}
                            options={[
                                { value: 'send', label: 'С этого устройства' },
                                { value: 'receive', label: 'На это устройство' },
                            ]}
                            onChange={changeMode}
                        />
                        {mode === 'send' ? (
                            <>
                                <Text style={ui.muted}>
                                    На втором устройстве войдите в тот же аккаунт и откройте
                                    «Аккаунт и безопасность → Перенести на устройство → На это
                                    устройство».
                                </Text>
                                <Notice text="Код открывает доступ к ключам переписки. Передавайте его только себе. Он одноразовый и действует 5 минут." />
                                {transfer && !expired ? (
                                    <View style={ui.card}>
                                        <Text style={ui.label}>
                                            Действует ещё {Math.floor(remaining / 60)}:
                                            {String(remaining % 60).padStart(2, '0')}
                                        </Text>
                                        <Text
                                            selectable
                                            style={ui.muted}
                                            testID="transfer-code"
                                        >
                                            {transfer.code}
                                        </Text>
                                        <Button
                                            title="Скопировать код"
                                            icon="copy"
                                            variant="secondary"
                                            busy={copyAction.busy}
                                            onPress={() => {
                                                void copyAction.run(
                                                    () => native.copyText(transfer.code),
                                                    'Код скопирован',
                                                );
                                            }}
                                            testID="transfer-copy"
                                        />
                                    </View>
                                ) : null}
                                <Notice
                                    text={
                                        expired ? 'Срок действия кода истёк. Создайте новый.' : null
                                    }
                                />
                                <Notice
                                    text={copyAction.error}
                                    tone="error"
                                />
                                <Notice
                                    text={copyAction.success}
                                    tone="success"
                                />
                                <Notice
                                    text={
                                        !state.encryption.ready
                                            ? 'На этом устройстве нет восстановленных ключей. Получите их с устройства, где история открывается.'
                                            : null
                                    }
                                />
                                <Button
                                    title={transfer ? 'Создать новый код' : 'Создать код переноса'}
                                    onPress={create}
                                    busy={action.busy}
                                    disabled={offline || !state.encryption.ready}
                                    icon="shield"
                                    testID="transfer-create"
                                />
                            </>
                        ) : (
                            <>
                                <Text style={ui.muted}>
                                    Создайте код на устройстве, где открывается история переписки, и
                                    вставьте его целиком. На обоих устройствах должен быть один
                                    аккаунт.
                                </Text>
                                <Field
                                    label="Код переноса"
                                    placeholder="Вставьте одноразовый код"
                                    value={code}
                                    onChangeText={setCode}
                                    autoCapitalize="none"
                                    autoComplete="off"
                                    multiline
                                    maxLength={512}
                                    editable={!action.busy}
                                    testID="transfer-input"
                                />
                                <Button
                                    title="Перенести ключи"
                                    icon="download"
                                    onPress={receive}
                                    busy={action.busy}
                                    disabled={offline || !code.trim()}
                                    testID="transfer-receive"
                                />
                            </>
                        )}
                        <Notice
                            text={action.error}
                            tone="error"
                        />
                        <Notice
                            text={
                                offline ? 'Для переноса ключей нужно подключение к серверу.' : null
                            }
                        />
                    </>
                )}
            </ScrollView>
        </View>
    );
}
