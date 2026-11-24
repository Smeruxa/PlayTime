import { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing } from 'react-native';
import { useReducedMotion } from './useReducedMotion';

export function useDecorativeMotion(duration: number, phase = 0.25, enabled = true) {
    const reduced = useReducedMotion();
    const progress = useRef(new Animated.Value(phase)).current;
    const [foreground, setForeground] = useState(AppState.currentState === 'active');
    useEffect(() => {
        const subscription = AppState.addEventListener('change', (state) =>
            setForeground(state === 'active'),
        );
        return () => subscription.remove();
    }, []);
    useEffect(() => {
        progress.setValue(phase);
        if (reduced || !foreground || !enabled) {
            return;
        }
        const timing = (toValue: number, milliseconds: number) =>
            Animated.timing(progress, {
                toValue,
                duration: milliseconds,
                easing: Easing.linear,
                useNativeDriver: true,
                isInteraction: false,
            });
        const animation = Animated.sequence([
            timing(1, duration * (1 - phase)),
            Animated.loop(Animated.sequence([timing(0, 0), timing(1, duration)])),
        ]);
        animation.start();
        return () => animation.stop();
    }, [duration, enabled, foreground, phase, progress, reduced]);
    return progress;
}
