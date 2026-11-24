import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, ui } from '../theme';

export function Notice({
    text,
    tone = 'info',
    action,
}: {
    text?: string | null;
    tone?: 'info' | 'error' | 'success';
    action?: React.ReactNode;
}) {
    if (!text) {
        return null;
    }
    return (
        <View
            style={[s.notice, tone === 'error' && { backgroundColor: colors.dangerSoft }]}
            accessibilityLiveRegion="polite"
        >
            <Text
                style={[
                    ui.muted,
                    {
                        color:
                            tone === 'error'
                                ? colors.danger
                                : tone === 'success'
                                ? colors.success
                                : colors.muted,
                    },
                ]}
            >
                {text}
            </Text>
            {action}
        </View>
    );
}

const s = StyleSheet.create({
    notice: { borderRadius: 14, padding: 14, backgroundColor: colors.surface, gap: 10 },
});
