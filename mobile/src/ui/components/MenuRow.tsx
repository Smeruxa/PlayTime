import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, ui } from '../theme';
import { Icon, type IconName } from '../Icon';

export function MenuRow({
    icon,
    title,
    description,
    onPress,
    danger,
    right,
    testID,
}: {
    icon: IconName;
    title: string;
    description?: string;
    onPress: () => void;
    danger?: boolean;
    right?: React.ReactNode;
    testID?: string;
}) {
    return (
        <Pressable
            testID={testID}
            accessibilityRole="button"
            onPress={onPress}
            style={({ pressed }) => [s.menuRow, { opacity: pressed ? 0.65 : 1 }]}
        >
            <View style={s.menuIcon}>
                <Icon
                    name={icon}
                    color={danger ? colors.danger : colors.accent}
                />
            </View>
            <View style={ui.fill}>
                <Text style={[ui.text, { fontWeight: '500' }, danger && { color: colors.danger }]}>
                    {title}
                </Text>
                {description ? <Text style={ui.caption}>{description}</Text> : null}
            </View>
            {right || (
                <Icon
                    name="chevron"
                    size={17}
                    color={colors.subtle}
                />
            )}
        </Pressable>
    );
}

const s = StyleSheet.create({
    menuRow: {
        minHeight: 72,
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    menuIcon: {
        width: 42,
        height: 42,
        borderRadius: 13,
        backgroundColor: colors.raised,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
