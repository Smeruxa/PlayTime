import React, { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Animated, Easing, StyleSheet, TextInput, View } from 'react-native';
import { SearchField } from '../../../ui/components';
import { useReducedMotion } from '../../../ui/hooks/useReducedMotion';

type Props = {
    visible: boolean;
    query: string;
    onChangeQuery: (query: string) => void;
    roomsOnly: boolean;
};

export function ConversationSearch({ visible, query, onChangeQuery, roomsOnly }: Props) {
    const input = useRef<ComponentRef<typeof TextInput>>(null);
    const progress = useRef(new Animated.Value(0)).current;
    const [mounted, setMounted] = useState(visible);
    const [height, setHeight] = useState(64);
    const reducedMotion = useReducedMotion();

    useEffect(() => {
        if (visible) {
            setMounted(true);
        }
        const animation = Animated.timing(progress, {
            toValue: visible ? 1 : 0,
            duration: reducedMotion ? 0 : 200,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
        });
        animation.start(({ finished }) => {
            if (!finished) {
                return;
            }
            if (visible) {
                input.current?.focus();
            } else {
                setMounted(false);
            }
        });
        return () => animation.stop();
    }, [visible, progress, reducedMotion]);

    if (!mounted && !visible) {
        return null;
    }

    return (
        <Animated.View
            pointerEvents={visible ? 'auto' : 'none'}
            importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
            style={[
                styles.container,
                {
                    height: progress.interpolate({ inputRange: [0, 1], outputRange: [0, height] }),
                    opacity: progress,
                },
            ]}
        >
            <View
                style={styles.content}
                onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
            >
                <SearchField
                    ref={input}
                    testID="conversation-search"
                    value={query}
                    onChangeText={onChangeQuery}
                    placeholder={roomsOnly ? 'Найти комнату' : 'Найти диалог'}
                />
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: { overflow: 'hidden' },
    content: {
        position: 'absolute',
        left: 0,
        right: 0,
        paddingHorizontal: 20,
        paddingBottom: 16,
    },
});
