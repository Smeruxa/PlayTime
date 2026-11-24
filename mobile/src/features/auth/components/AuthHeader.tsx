import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { IconButton } from '../../../ui/components';
import { Icon } from '../../../ui/Icon';
import { colors, ui } from '../../../ui/theme';
import type { Authentication } from '../hooks/useAuthentication';
import { authCopy } from '../authCopy';

export function AuthHeader({ form }: { form: Authentication }) {
    const copy = authCopy(form.mode, form.done, form.sent);
    return (
        <View style={styles.content}>
            <View style={ui.between}>
                <View style={ui.row}>
                    <View style={styles.brandMark}>
                        <Icon
                            name="chat"
                            color={colors.accent}
                        />
                    </View>
                    <Text style={styles.brand}>PlayTime</Text>
                </View>
                {form.mode !== 'login' && (
                    <IconButton
                        name="close"
                        label="Вернуться ко входу"
                        disabled={form.action.busy}
                        onPress={() => form.changeMode('login')}
                    />
                )}
            </View>
            <View style={styles.heading}>
                <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
                <Text style={styles.title}>{copy.title}</Text>
                <Text style={ui.muted}>{copy.description}</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    content: { gap: 24 },
    brandMark: {
        height: 40,
        width: 40,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.accentSoft,
    },
    brand: { fontSize: 22, fontWeight: '700', letterSpacing: -0.7, color: colors.text },
    heading: { gap: 14, marginTop: 16, marginBottom: 4 },
    eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.6, color: colors.accent },
    title: {
        fontSize: 38,
        fontWeight: '700',
        lineHeight: 43,
        letterSpacing: -1.5,
        color: colors.text,
    },
});
