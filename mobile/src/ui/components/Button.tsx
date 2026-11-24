import React from 'react';
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    type ViewStyle,
    type StyleProp,
} from 'react-native';
import { colors } from '../theme';
import { Icon, type IconName } from '../Icon';

export function Button({
    title,
    onPress,
    variant = 'primary',
    disabled,
    busy,
    icon,
    testID,
    style,
}: {
    title: string;
    onPress: () => void;
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    disabled?: boolean;
    busy?: boolean;
    icon?: IconName;
    testID?: string;
    style?: StyleProp<ViewStyle>;
}) {
    const fg =
        variant === 'primary' ? '#071C2D' : variant === 'danger' ? colors.danger : colors.text;
    return (
        <Pressable
            testID={testID}
            accessibilityRole="button"
            accessibilityLabel={title}
            accessibilityState={{ disabled: !!disabled || !!busy, busy }}
            disabled={disabled || busy}
            onPress={onPress}
            style={({ pressed }) => [
                s.button,
                variant === 'primary'
                    ? s.primary
                    : variant === 'danger'
                    ? s.danger
                    : variant === 'secondary'
                    ? s.secondary
                    : null,
                { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
                style,
            ]}
        >
            {busy ? (
                <ActivityIndicator
                    size="small"
                    color={fg}
                />
            ) : icon ? (
                <Icon
                    name={icon}
                    size={19}
                    color={fg}
                />
            ) : null}
            <Text style={[s.buttonText, { color: fg }]}>{title}</Text>
        </Pressable>
    );
}

const s = StyleSheet.create({
    button: {
        minHeight: 50,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 9,
        paddingHorizontal: 18,
        paddingVertical: 13,
    },
    buttonText: { fontSize: 15, fontWeight: '700', flexShrink: 1, textAlign: 'center' },
    primary: { backgroundColor: colors.accent },
    secondary: { backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border },
    danger: { backgroundColor: colors.dangerSoft },
});
