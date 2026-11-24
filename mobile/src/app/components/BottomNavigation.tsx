import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '../../ui/Icon';
import { colors } from '../../ui/theme';
import { useApp, type Tab } from '../../state/AppContext';

const destinations: { tab: Tab; title: string; icon: IconName }[] = [
    { tab: 'chats', title: 'Чаты', icon: 'chat' },
    { tab: 'friends', title: 'Друзья', icon: 'people' },
    { tab: 'rooms', title: 'Комнаты', icon: 'room' },
    { tab: 'profile', title: 'Вы', icon: 'person' },
];

export function BottomNavigation() {
    const { tab, setTab, state } = useApp();
    return (
        <View
            style={styles.bar}
            testID="bottom-navigation"
        >
            {destinations.map((destination) => {
                const active = tab === destination.tab;
                return (
                    <Pressable
                        key={destination.tab}
                        testID={`tab-${destination.tab}`}
                        accessibilityRole="tab"
                        accessibilityLabel={destination.title}
                        accessibilityState={{ selected: active }}
                        onPress={() => setTab(destination.tab)}
                        style={styles.tab}
                    >
                        <View style={[styles.icon, active && styles.active]}>
                            <Icon
                                name={destination.icon}
                                size={22}
                                color={active ? colors.accent : colors.muted}
                            />
                            {destination.tab === 'friends' && state.incoming.length > 0 && (
                                <View style={styles.dot} />
                            )}
                        </View>
                        <Text
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.65}
                            style={[styles.label, { color: active ? colors.accent : colors.muted }]}
                        >
                            {destination.title}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    bar: {
        flexDirection: 'row',
        backgroundColor: '#1B1B1B',
        borderTopWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        paddingTop: 7,
        paddingBottom: 5,
        minHeight: 70,
    },
    tab: { flex: 1, alignItems: 'center', gap: 3, minHeight: 56 },
    icon: {
        width: 54,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
    active: { backgroundColor: colors.accentSoft, borderRadius: 16 },
    label: { fontSize: 11, fontWeight: '600', maxWidth: '100%', paddingHorizontal: 4 },
    dot: {
        position: 'absolute',
        width: 7,
        height: 7,
        right: 12,
        top: 4,
        backgroundColor: colors.accent,
        borderRadius: 4,
    },
});
