import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../../../ui/theme';

type Props = {
    positionMs: number;
    durationMs: number;
    disabled: boolean;
    onSeek: (fraction: number) => void;
};

export function PlaybackProgress({ positionMs, durationMs, disabled, onSeek }: Props) {
    const [width, setWidth] = useState(1);
    const [scrub, setScrub] = useState<number | null>(null);
    const fraction = Math.max(0, Math.min(1, scrub ?? positionMs / (durationMs || 1)));
    const fromTouch = (x: number) => Math.max(0, Math.min(1, x / width));
    return (
        <View
            accessibilityRole="adjustable"
            accessibilityLabel="Позиция голосового сообщения"
            accessibilityState={{ disabled }}
            accessibilityValue={{ min: 0, max: durationMs / 1000, now: positionMs / 1000 }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(event) => {
                if (!disabled) {
                    const change = event.nativeEvent.actionName === 'increment' ? 5000 : -5000;
                    onSeek(Math.max(0, Math.min(1, (positionMs + change) / (durationMs || 1))));
                }
            }}
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            onStartShouldSetResponder={() => !disabled}
            onMoveShouldSetResponder={() => !disabled}
            onResponderGrant={(event) => setScrub(fromTouch(event.nativeEvent.locationX))}
            onResponderMove={(event) => setScrub(fromTouch(event.nativeEvent.locationX))}
            onResponderRelease={(event) => {
                onSeek(fromTouch(event.nativeEvent.locationX));
                setScrub(null);
            }}
            onResponderTerminate={() => setScrub(null)}
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
                style={[styles.thumb, { left: fraction * (width - 10) }]}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    touch: { height: 48, minWidth: 150, justifyContent: 'center' },
    track: { height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
    fill: { height: 4, backgroundColor: colors.accent },
    thumb: {
        position: 'absolute',
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: colors.accent,
    },
});
