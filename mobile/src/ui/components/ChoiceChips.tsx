import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { colors } from '../theme';

export function ChoiceChips<T extends string>({
    options,
    value,
    onChange,
}: {
    options: { value: T; label: string }[];
    value: T;
    onChange: (v: T) => void;
}) {
    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
        >
            {options.map((option) => (
                <Pressable
                    key={option.value}
                    onPress={() => onChange(option.value)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: value === option.value }}
                    style={[s.chip, value === option.value && s.chipActive]}
                >
                    <Text
                        style={{
                            fontSize: 14,
                            fontWeight: '600',
                            color: value === option.value ? colors.accent : colors.muted,
                        }}
                    >
                        {option.label}
                    </Text>
                </Pressable>
            ))}
        </ScrollView>
    );
}

const s = StyleSheet.create({
    chip: {
        paddingHorizontal: 16,
        paddingVertical: 11,
        borderRadius: 20,
        backgroundColor: colors.surface,
        minHeight: 44,
        justifyContent: 'center',
    },
    chipActive: { backgroundColor: colors.accentSoft },
});
