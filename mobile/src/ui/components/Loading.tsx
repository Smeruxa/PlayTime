import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, ui } from '../theme';

export function Loading({ label = 'Загрузка…' }: { label?: string }) {
    return (
        <View style={s.empty}>
            <ActivityIndicator
                size="large"
                color={colors.accent}
            />
            <Text style={ui.muted}>{label}</Text>
        </View>
    );
}

const s = StyleSheet.create({
    empty: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        gap: 14,
        minHeight: 240,
    },
});
