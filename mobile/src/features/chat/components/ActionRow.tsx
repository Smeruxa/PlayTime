import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Icon } from '../../../ui/Icon';
import { colors, ui } from '../../../ui/theme';

export function ActionRow({
    icon,
    title,
    onPress,
    danger,
}: {
    icon: React.ComponentProps<typeof Icon>['name'];
    title: string;
    onPress: () => void;
    danger?: boolean;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={title}
            onPress={onPress}
            style={s.action}
        >
            <Icon
                name={icon}
                size={21}
                color={danger ? colors.danger : colors.muted}
            />
            <Text style={[ui.text, danger && { color: colors.danger }]}>{title}</Text>
        </Pressable>
    );
}

const s = StyleSheet.create({
    action: {
        minHeight: 54,
        flexDirection: 'row',
        gap: 16,
        alignItems: 'center',
        paddingHorizontal: 22,
        paddingVertical: 12,
    },
});
