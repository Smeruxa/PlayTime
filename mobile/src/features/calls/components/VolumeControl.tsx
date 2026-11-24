import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button } from '../../../ui/components';
import { colors, ui } from '../../../ui/theme';
import { styles } from './styles';

export function VolumeControl({
    label,
    value,
    onChange,
    testID,
}: {
    label: string;
    value: number;
    onChange: (value: number) => void;
    testID: string;
}) {
    return (
        <View style={ui.stack}>
            <View style={ui.between}>
                <Text style={[ui.text, ui.fill]}>{label}</Text>
                <Text style={[ui.heading, { color: colors.accent }]}>{value}%</Text>
            </View>
            <View style={styles.volumeRow}>
                <Button
                    title="−"
                    testID={`${testID}-down`}
                    variant="secondary"
                    disabled={value <= 0}
                    onPress={() => onChange(Math.max(0, value - 10))}
                />
                <View
                    style={styles.volumeTrack}
                    accessible
                    accessibilityRole="adjustable"
                    accessibilityLabel={label}
                    accessibilityValue={{ min: 0, max: 200, now: value, text: `${value}%` }}
                    accessibilityActions={[
                        { name: 'increment', label: 'Громче' },
                        { name: 'decrement', label: 'Тише' },
                    ]}
                    onAccessibilityAction={(event) =>
                        onChange(
                            Math.max(
                                0,
                                Math.min(
                                    200,
                                    value +
                                        (event.nativeEvent.actionName === 'increment' ? 10 : -10),
                                ),
                            ),
                        )
                    }
                >
                    <View style={[styles.volumeFill, { width: `${value / 2}%` }]} />
                </View>
                <Button
                    title="+"
                    testID={`${testID}-up`}
                    variant="secondary"
                    disabled={value >= 200}
                    onPress={() => onChange(Math.min(200, value + 10))}
                />
            </View>
            <View style={styles.presets}>
                {[0, 50, 100, 150, 200].map((preset) => (
                    <Pressable
                        key={preset}
                        accessibilityRole="button"
                        accessibilityLabel={`${label}: ${preset}%`}
                        accessibilityState={{ selected: value === preset }}
                        onPress={() => onChange(preset)}
                        style={[styles.preset, value === preset && styles.presetSelected]}
                    >
                        <Text style={{ color: value === preset ? colors.accent : colors.muted }}>
                            {preset}%
                        </Text>
                    </Pressable>
                ))}
            </View>
        </View>
    );
}
