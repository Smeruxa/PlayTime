import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { confirm } from '../../../platform/device';
import { colors } from '../../../ui/theme';

const HOLD_DURATION_MS = 3000;

export function HoldDeleteButton({
    disabled,
    onComplete,
}: {
    disabled: boolean;
    onComplete: () => void;
}) {
    const [progress, setProgress] = useState(0);
    const [screenReader, setScreenReader] = useState(false);
    const timer = useRef<ReturnType<typeof setInterval> | null>(null);
    const complete = useRef(onComplete);
    complete.current = onComplete;
    const cancel = useCallback(() => {
        if (timer.current) {
            clearInterval(timer.current);
            timer.current = null;
        }
        setProgress(0);
    }, []);

    useEffect(() => {
        let active = true;
        void AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
            if (active) {
                setScreenReader(enabled);
            }
        });
        const accessibility = AccessibilityInfo.addEventListener(
            'screenReaderChanged',
            setScreenReader,
        );
        const app = AppState.addEventListener('change', (state) => {
            if (state !== 'active') {
                cancel();
            }
        });
        return () => {
            active = false;
            if (timer.current) {
                clearInterval(timer.current);
            }
            accessibility.remove();
            app.remove();
        };
    }, [cancel]);
    useEffect(() => {
        if (disabled) {
            cancel();
        }
    }, [cancel, disabled]);

    const begin = () => {
        if (disabled || screenReader || timer.current) {
            return;
        }
        const started = Date.now();
        timer.current = setInterval(() => {
            const elapsed = Date.now() - started;
            if (elapsed >= HOLD_DURATION_MS) {
                cancel();
                complete.current();
            } else {
                setProgress(elapsed / HOLD_DURATION_MS);
            }
        }, 50);
    };
    const accessibleDelete = async () => {
        if (
            screenReader &&
            !disabled &&
            (await confirm(
                'Удалить аккаунт навсегда?',
                'Это последнее подтверждение. Восстановить аккаунт и данные будет невозможно.',
                'Удалить навсегда',
                true,
            ))
        ) {
            complete.current();
        }
    };

    return (
        <Pressable
            testID="delete-hold"
            accessibilityRole="button"
            accessibilityLabel="Удалить аккаунт навсегда"
            accessibilityHint={
                screenReader
                    ? 'Откроется последнее подтверждение удаления'
                    : 'Удерживайте три секунды. Отпустите, чтобы отменить'
            }
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPressIn={begin}
            onPressOut={cancel}
            onTouchCancel={cancel}
            onPress={() => {
                void accessibleDelete();
            }}
            style={[styles.button, disabled && styles.disabled]}
        >
            <View
                pointerEvents="none"
                style={[styles.progress, { width: `${Math.round(progress * 100)}%` }]}
            />
            <Text style={styles.text}>
                {screenReader
                    ? 'Удалить аккаунт навсегда'
                    : progress > 0
                    ? `Удерживайте ещё ${Math.ceil(3 * (1 - progress))} с`
                    : 'Удерживайте 3 с для удаления'}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    button: {
        minHeight: 56,
        padding: 16,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.danger,
        backgroundColor: colors.dangerSoft,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    disabled: { opacity: 0.4 },
    progress: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#71333A' },
    text: { color: colors.danger, fontWeight: '700', fontSize: 15, textAlign: 'center' },
});
