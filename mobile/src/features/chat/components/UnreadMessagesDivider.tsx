import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../../ui/theme';

export function UnreadMessagesDivider() {
    return (
        <View
            testID="unread-messages-divider"
            accessibilityLabel="Новые сообщения"
            style={styles.divider}
        >
            <View style={styles.line} />
            <Text style={styles.label}>Новые сообщения</Text>
            <View style={styles.line} />
        </View>
    );
}

const styles = StyleSheet.create({
    divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 16 },
    line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.accent },
    label: { color: colors.accent, fontSize: 12, fontWeight: '600', flexShrink: 1 },
});
