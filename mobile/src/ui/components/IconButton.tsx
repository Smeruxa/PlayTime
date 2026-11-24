import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { colors } from '../theme';
import { Icon, type IconName } from '../Icon';

export function IconButton({
    name,
    label,
    onPress,
    color = colors.text,
    disabled,
    testID,
    selected,
}: {
    name: IconName;
    label: string;
    onPress: () => void;
    color?: string;
    disabled?: boolean;
    testID?: string;
    selected?: boolean;
}) {
    return (
        <Pressable
            testID={testID}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled: !!disabled, selected }}
            onPress={onPress}
            disabled={disabled}
            hitSlop={3}
            style={({ pressed }) => [
                s.iconButton,
                selected && { backgroundColor: colors.accentSoft },
                { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 },
            ]}
        >
            <Icon
                name={name}
                color={color}
            />
        </Pressable>
    );
}

const s = StyleSheet.create({
    iconButton: {
        width: 48,
        height: 48,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
