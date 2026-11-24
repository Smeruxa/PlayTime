import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, ui } from '../theme';

type Props = {
    label: string;
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
};

export function RangeControl({ label, value, onChange, min = 0, max = 100, step = 1 }: Props) {
    const [width, setWidth] = useState(1);
    const fraction = (value - min) / (max - min);
    const update = (next: number) =>
        onChange(Math.max(min, Math.min(max, Math.round(next / step) * step)));
    const touch = (location: number) => update(min + (location / width) * (max - min));
    return (
        <View style={ui.smallStack}>
            <View style={ui.between}>
                <Text style={ui.label}>{label}</Text>
                <Text style={ui.caption}>{Math.round(value)}%</Text>
            </View>
            <View
                accessibilityRole="adjustable"
                accessibilityLabel={label}
                accessibilityValue={{ min, max, now: value }}
                accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                onAccessibilityAction={(event) =>
                    update(value + (event.nativeEvent.actionName === 'increment' ? step : -step))
                }
                onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={(event) => touch(event.nativeEvent.locationX)}
                onResponderMove={(event) => touch(event.nativeEvent.locationX)}
                style={styles.touch}
            >
                <View
                    pointerEvents="none"
                    style={styles.track}
                >
                    <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
                </View>
                <View
                    pointerEvents="none"
                    style={[styles.thumb, { left: Math.max(0, fraction * (width - 22)) }]}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    touch: { height: 44, justifyContent: 'center' },
    track: { height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
    fill: { height: 4, backgroundColor: colors.accent },
    thumb: {
        position: 'absolute',
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: colors.accent,
    },
});
