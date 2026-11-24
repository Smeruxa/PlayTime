import React from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { ui } from '../theme';
import { IconButton } from './IconButton';

export function Header({
    title,
    subtitle,
    onBack,
    right,
}: {
    title: string;
    subtitle?: string;
    onBack?: () => void;
    right?: React.ReactNode;
}) {
    const { height } = useWindowDimensions();
    const compact = height < 500;
    return (
        <View style={[s.header, compact && s.compact]}>
            {onBack && (
                <IconButton
                    name="back"
                    label="Назад"
                    testID="back"
                    onPress={onBack}
                />
            )}
            <View style={ui.fill}>
                <Text
                    numberOfLines={1}
                    style={onBack || compact ? ui.heading : ui.title}
                >
                    {title}
                </Text>
                {!!subtitle && !compact && (
                    <Text
                        numberOfLines={1}
                        style={ui.caption}
                    >
                        {subtitle}
                    </Text>
                )}
            </View>
            {right}
        </View>
    );
}

const s = StyleSheet.create({
    compact: { minHeight: 56, paddingVertical: 4 },
    header: {
        minHeight: 82,
        paddingHorizontal: 20,
        paddingVertical: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
});
