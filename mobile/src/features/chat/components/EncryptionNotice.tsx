import React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Button, Notice } from '../../../ui/components';
import { useApp } from '../../../state/AppContext';
import { useAction } from '../../../state/useAction';
import { confirm } from '../../../platform/device';
import { keyFingerprint } from '../../../services/keyFingerprint';
import { MissingEncryptionKeyActions } from './MissingEncryptionKeyActions';

export function EncryptionNotice() {
    const { client, state } = useApp();
    const action = useAction();
    const encryption = state.encryption;
    const { height } = useWindowDimensions();
    const changedPeer =
        !state.currentChat?.isRoom && encryption.changedPeer?.peerUserId === state.currentChat?.id
            ? encryption.changedPeer
            : undefined;
    if (encryption.ready && !encryption.needsRecovery && !changedPeer) {
        return null;
    }
    if (encryption.needsRecovery && !changedPeer) {
        return height < 500 ? null : <MissingEncryptionKeyActions />;
    }
    const explanation = changedPeer
        ? 'Ключ собеседника изменился. Сверьте его перед отправкой.'
        : encryption.needsRecovery
        ? 'Старый ключ недоступен. Восстановите историю или продолжите переписку с новым ключом.'
        : encryption.error || 'Подготавливаем защищённое соединение…';

    return (
        <View style={{ padding: 12 }}>
            <Notice
                text={action.error || explanation}
                tone="error"
                action={
                    changedPeer ? (
                        <Button
                            title="Проверить ключ"
                            variant="secondary"
                            busy={action.busy}
                            onPress={() =>
                                void action.run(async () => {
                                    const key = changedPeer;
                                    if (
                                        key &&
                                        (await confirm(
                                            'Новый ключ собеседника',
                                            `Сверьте отпечаток с ${
                                                key.username
                                            } по другому каналу:\n\n${await keyFingerprint(
                                                key.key,
                                            )}\n\nПринимайте ключ только после проверки.`,
                                            'Доверять ключу',
                                        ))
                                    ) {
                                        await client.trustChangedPeer(key.key, key.peerUserId);
                                    }
                                })
                            }
                        />
                    ) : encryption.needsRecovery ? (
                        <MissingEncryptionKeyActions />
                    ) : undefined
                }
            />
        </View>
    );
}
