import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../../ui/components';
import { Icon } from '../../../ui/Icon';
import { colors, ui } from '../../../ui/theme';
import { openLink } from '../../../platform/device';
import type { Authentication } from '../hooks/useAuthentication';

export function AuthLegalConsent({ form }: { form: Authentication }) {
    const { accepted, setAccepted, action } = form;
    return (
        <View>
            <Pressable
                testID="auth-legal"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: accepted }}
                onPress={() => setAccepted(!accepted)}
                style={[ui.row, { minHeight: 48 }]}
            >
                <View
                    style={[
                        s.checkbox,
                        accepted && {
                            borderColor: colors.accent,
                            backgroundColor: colors.accentSoft,
                        },
                    ]}
                >
                    {accepted && (
                        <Icon
                            name="check"
                            size={16}
                            color={colors.accent}
                        />
                    )}
                </View>
                <Text style={[ui.muted, ui.fill]}>
                    Принимаю условия использования и политику конфиденциальности
                </Text>
            </Pressable>
            <View style={[ui.row, { flexWrap: 'wrap' }]}>
                <Button
                    title="Условия"
                    variant="ghost"
                    style={{ maxWidth: '100%' }}
                    onPress={() =>
                        void action.run(() => openLink('https://smeruxa.ru/playtime/legal/terms'))
                    }
                />
                <Button
                    title="Конфиденциальность"
                    variant="ghost"
                    style={{ maxWidth: '100%' }}
                    onPress={() =>
                        void action.run(() => openLink('https://smeruxa.ru/playtime/legal/privacy'))
                    }
                />
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    checkbox: {
        width: 23,
        height: 23,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 7,
        justifyContent: 'center',
        alignItems: 'center',
    },
});
