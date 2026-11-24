import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, ui } from '../../../ui/theme';

const SEGMENT_COUNT = 20;

export function MicrophoneLevelMeter({ level }: { level: number }) {
    const normalized = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
    const percentage = Math.round(normalized * 100);
    const activeSegments = Math.round(normalized * SEGMENT_COUNT);

    return (
        <View style={ui.smallStack}>
            <View style={ui.between}>
                <Text style={[ui.caption, styles.label]}>Уровень микрофона</Text>
                <Text style={ui.caption}>{percentage}%</Text>
            </View>
            <View
                testID="microphone-level"
                accessibilityRole="progressbar"
                accessibilityLabel="Уровень микрофона"
                accessibilityValue={{ min: 0, max: 100, now: percentage }}
                style={styles.meter}
            >
                {Array.from({ length: SEGMENT_COUNT }, (_, index) => (
                    <View
                        key={index}
                        style={[
                            styles.segment,
                            {
                                backgroundColor:
                                    index >= activeSegments
                                        ? colors.raised
                                        : index >= 18
                                        ? colors.danger
                                        : index >= 14
                                        ? colors.warning
                                        : colors.success,
                            },
                        ]}
                    />
                ))}
            </View>
            <Text style={ui.caption}>
                Говорите обычным голосом. Красная зона означает слишком громкий сигнал.
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    label: { flex: 1 },
    meter: {
        flexDirection: 'row',
        gap: 3,
        height: 16,
    },
    segment: {
        flex: 1,
        borderRadius: 3,
    },
});
