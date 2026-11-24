import React from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Icon, type IconName } from '../../../ui/Icon';
import { colors } from '../../../ui/theme';
import { styles } from './styles';

export function CallAction({
    icon,
    title,
    selected,
    danger,
    onPress,
    disabled,
    testID,
    wide = false,
}: {
    icon: IconName;
    title: string;
    selected?: boolean;
    danger?: boolean;
    onPress: () => void;
    disabled?: boolean;
    testID: string;
    wide?: boolean;
}) {
    const { fontScale } = useWindowDimensions();
    return (
        <Pressable
            testID={testID}
            accessibilityRole="button"
            accessibilityLabel={title}
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [
                styles.action,
                wide && styles.actionWide,
                { opacity: disabled ? 0.4 : pressed ? 0.65 : 1 },
            ]}
        >
            <View
                style={[
                    styles.actionIcon,
                    selected && styles.actionSelected,
                    danger && styles.actionDanger,
                ]}
            >
                <Icon
                    name={icon}
                    color={danger ? '#fff' : selected ? colors.accent : colors.text}
                    size={25}
                />
                {selected && icon === 'mic' && <View style={styles.micSlash} />}
            </View>
            <Text style={[styles.actionLabel, fontScale > 1.4 && styles.actionLabelLarge]}>
                {title}
            </Text>
        </Pressable>
    );
}
