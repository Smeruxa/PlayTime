import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../../ui/Icon';
import { colors, ui } from '../../../ui/theme';

type Props = {
    title: string;
    testID?: string;
    options: { id: string; title: string }[];
    value: string;
    allowed: (id: string) => boolean;
    onChange: (id: string) => void;
    onLocked: () => void;
};

export function EffectPicker({
    title,
    testID,
    options,
    value,
    allowed,
    onChange,
    onLocked,
}: Props) {
    return (
        <View style={ui.stack}>
            <Text style={ui.label}>{title}</Text>
            <View style={styles.options}>
                {options.map((option) => (
                    <Pressable
                        key={option.id}
                        testID={testID ? `${testID}-${option.id}` : undefined}
                        accessibilityRole="radio"
                        accessibilityLabel={option.title}
                        accessibilityState={{ checked: value === option.id }}
                        onPress={() => (allowed(option.id) ? onChange(option.id) : onLocked())}
                        style={[styles.option, value === option.id && styles.selected]}
                    >
                        <Text style={[ui.muted, value === option.id && { color: colors.accent }]}>
                            {option.title}
                        </Text>
                        {!allowed(option.id) && (
                            <Icon
                                name="lock"
                                size={13}
                                color={colors.subtle}
                            />
                        )}
                    </Pressable>
                ))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    option: {
        minHeight: 44,
        paddingHorizontal: 14,
        paddingVertical: 11,
        borderRadius: 13,
        backgroundColor: colors.raised,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        borderWidth: 1,
        borderColor: colors.border,
    },
    selected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
});
