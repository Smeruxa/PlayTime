import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, ui } from '../theme';
import { Icon, type IconName } from '../Icon';

export function Empty({
    icon = 'chat',
    title,
    description,
    action,
}: {
    icon?: IconName;
    title: string;
    description: string;
    action?: React.ReactNode;
}) {
    return (
        <View style={s.empty}>
            <View style={s.emptyIcon}>
                <Icon
                    name={icon}
                    size={34}
                    color={colors.accent}
                />
            </View>
            <Text style={[ui.heading, { textAlign: 'center' }]}>{title}</Text>
            <Text style={[ui.muted, { textAlign: 'center', maxWidth: 300 }]}>{description}</Text>
            {action}
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
    emptyIcon: {
        backgroundColor: colors.accentSoft,
        width: 76,
        height: 76,
        borderRadius: 26,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 4,
    },
});
