import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { confirm } from '../../../platform/device';
import { useApp } from '../../../state/AppContext';
import { useAction } from '../../../state/useAction';
import { Button, Notice } from '../../../ui/components';
import { ui } from '../../../ui/theme';

export function EncryptionKeyDetails({
    disabled,
    onReset,
    onBusyChange,
}: {
    disabled: boolean;
    onReset: () => void;
    onBusyChange: (busy: boolean) => void;
}) {
    const { client, state } = useApp();
    const action = useAction();
    const [expanded, setExpanded] = useState(false);
    const [fingerprint, setFingerprint] = useState<string | null>(null);
    useEffect(() => {
        onBusyChange(action.busy);
    }, [action.busy, onBusyChange]);
    useEffect(() => {
        let active = true;
        if (expanded) {
            void client
                .encryptionFingerprint()
                .then((value) => {
                    if (active) {
                        setFingerprint(value);
                    }
                })
                .catch(() => {
                    if (active) {
                        setFingerprint(null);
                    }
                });
        }
        return () => {
            active = false;
        };
    }, [client, expanded, state.encryption.ready, action.success]);
    const reset = () => {
        let changed = false;
        void action
            .run(async () => {
                if (
                    !(await confirm(
                        'Создать новый ключ переписки?',
                        'Старые зашифрованные сообщения не откроются с новым ключом. Ключи этого устройства будут заменены. Сначала сохраните копию или перенесите ключи с другого устройства.',
                        'Создать новый ключ',
                        true,
                    ))
                ) {
                    return;
                }
                await client.resetEncryptionKeys();
                changed = true;
                onReset();
            })
            .then(() => {
                if (changed) {
                    action.setSuccess('Новый ключ создан. Сохраните его резервную копию.');
                }
            });
    };
    return (
        <View style={ui.stack}>
            <Button
                title={expanded ? 'Скрыть сведения о ключе' : 'Мой ключ переписки'}
                variant="ghost"
                icon="shield"
                onPress={() => setExpanded(!expanded)}
            />
            {expanded ? (
                <View style={ui.card}>
                    <Text style={ui.label}>Отпечаток ключа на этом устройстве</Text>
                    <Text
                        selectable
                        style={ui.muted}
                    >
                        {fingerprint || 'Локальный ключ не восстановлен'}
                    </Text>
                    <Text style={ui.caption}>
                        Сверьте отпечаток с другим устройством. Новый ключ не восстановит старую
                        историю.
                    </Text>
                    <Notice
                        text={action.error}
                        tone="error"
                    />
                    <Notice
                        text={action.success}
                        tone="success"
                    />
                    <Button
                        title="Создать новый ключ"
                        variant="danger"
                        onPress={reset}
                        busy={action.busy}
                        disabled={disabled || state.connection !== 'online'}
                        testID="keys-reset"
                    />
                </View>
            ) : null}
        </View>
    );
}
