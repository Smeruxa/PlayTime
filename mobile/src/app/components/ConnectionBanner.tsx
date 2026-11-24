import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useApp } from '../../state/AppContext';
import { colors } from '../../ui/theme';

export function ConnectionBanner() {
    const { client, state } = useApp();
    if (state.connection === 'online') {
        return null;
    }
    return (
        <Pressable
            testID="connection-banner"
            accessibilityRole="button"
            accessibilityLabel="Повторить подключение"
            onPress={() => void client.reconnect().catch(() => {})}
            style={styles.banner}
        >
            <Text style={styles.text}>
                {state.connection === 'connecting'
                    ? 'Подключаемся…'
                    : 'Нет соединения · нажмите, чтобы повторить'}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    banner: {
        backgroundColor: '#332D20',
        paddingHorizontal: 14,
        paddingVertical: 10,
        minHeight: 40,
        justifyContent: 'center',
    },
    text: { color: colors.warning, fontSize: 12, textAlign: 'center' },
});
