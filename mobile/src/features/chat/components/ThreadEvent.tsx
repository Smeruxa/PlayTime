import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../../ui/theme';

export function ThreadEvent({ text }: { text: string }) {
    return (
        <View style={styles.event}>
            <Text style={styles.text}>{text}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    event: {
        alignSelf: 'center',
        maxWidth: '90%',
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 8,
        marginVertical: 8,
        backgroundColor: colors.surface,
    },
    text: { textAlign: 'center', color: colors.muted, fontSize: 12, lineHeight: 18 },
});
