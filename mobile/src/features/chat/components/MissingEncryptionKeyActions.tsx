import React, { useState } from 'react';
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, IconButton, Notice } from '../../../ui/components';
import { Icon } from '../../../ui/Icon';
import { colors, ui } from '../../../ui/theme';
import { useApp } from '../../../state/AppContext';
import { useAction } from '../../../state/useAction';
import { confirm } from '../../../platform/device';

export function MissingEncryptionKeyActions({ compact = false }: { compact?: boolean }) {
    const { client, navigate } = useApp();
    const action = useAction();
    const insets = useSafeAreaInsets();
    const [open, setOpen] = useState(false);
    return (
        <>
            {compact ? (
                <IconButton
                    name="lock"
                    label="Старый ключ недоступен. Выбрать действие"
                    testID="encryption-missing-key-actions"
                    color={colors.accent}
                    onPress={() => {
                        Keyboard.dismiss();
                        setOpen(true);
                    }}
                />
            ) : (
                <Pressable
                    testID="encryption-missing-key-actions"
                    accessibilityRole="button"
                    accessibilityLabel="Старый ключ недоступен. Выбрать действие"
                    onPress={() => {
                        Keyboard.dismiss();
                        setOpen(true);
                    }}
                    style={styles.notice}
                >
                    <Icon
                        name="lock"
                        color={colors.accent}
                        size={18}
                    />
                    <Text
                        numberOfLines={1}
                        style={styles.noticeText}
                    >
                        Ключ недоступен · действия
                    </Text>
                    <Icon
                        name="chevron"
                        color={colors.accent}
                        size={18}
                    />
                </Pressable>
            )}
            <Modal
                transparent
                visible={open}
                animationType="fade"
                onRequestClose={() => setOpen(false)}
            >
                <View
                    style={[
                        styles.overlay,
                        {
                            paddingTop: insets.top + 12,
                            paddingBottom: insets.bottom + 12,
                            paddingLeft: insets.left + 12,
                            paddingRight: insets.right + 12,
                        },
                    ]}
                >
                    <Pressable
                        accessibilityLabel="Закрыть действия с ключом"
                        style={StyleSheet.absoluteFill}
                        onPress={() => setOpen(false)}
                    />
                    <View
                        style={styles.sheet}
                        testID="encryption-missing-key-sheet"
                    >
                        <ScrollView
                            contentContainerStyle={ui.content}
                            keyboardShouldPersistTaps="handled"
                        >
                            <Text style={styles.title}>Старый ключ недоступен</Text>
                            <Text style={ui.muted}>
                                Восстановите историю с другого устройства или продолжите защищённую
                                переписку с новым ключом.
                            </Text>
                            <Notice
                                text={action.error}
                                tone="error"
                            />
                            <Button
                                title="Продолжить с новым ключом"
                                testID="encryption-continue-new-key"
                                variant="secondary"
                                busy={action.busy}
                                onPress={() =>
                                    void action.run(async () => {
                                        if (
                                            await confirm(
                                                'Продолжить переписку?',
                                                'Новые сообщения будут зашифрованы новым ключом. Старую историю можно будет открыть после восстановления прежних ключей. Собеседникам может понадобиться подтвердить смену вашего ключа.',
                                                'Продолжить',
                                            )
                                        ) {
                                            await client.continueWithNewEncryptionKey();
                                            setOpen(false);
                                        }
                                    })
                                }
                            />
                            <Button
                                title="Восстановить старую историю"
                                variant="ghost"
                                disabled={action.busy}
                                onPress={() => {
                                    setOpen(false);
                                    navigate({ name: 'transfer' });
                                }}
                            />
                        </ScrollView>
                    </View>
                </View>
            </Modal>
        </>
    );
}

const styles = StyleSheet.create({
    notice: {
        minHeight: 44,
        paddingHorizontal: 12,
        paddingVertical: 6,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: colors.surface,
    },
    title: { color: colors.text, fontSize: 18, fontWeight: '700' },
    noticeText: { color: colors.text, fontSize: 13, flex: 1 },
    overlay: {
        flex: 1,
        justifyContent: 'flex-end',
        paddingHorizontal: 12,
        backgroundColor: '#0009',
    },
    sheet: {
        maxHeight: '90%',
        borderRadius: 18,
        overflow: 'hidden',
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
    },
});
