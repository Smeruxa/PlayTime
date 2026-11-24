import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, ui } from '../theme';

export function SectionLabel({
    children,
    right,
}: {
    children: React.ReactNode;
    right?: React.ReactNode;
}) {
    return (
        <View style={ui.between}>
            <Text style={s.sectionLabel}>{children}</Text>
            {right}
        </View>
    );
}

const s = StyleSheet.create({
    sectionLabel: {
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 1.1,
        textTransform: 'uppercase',
        color: colors.muted,
    },
});
