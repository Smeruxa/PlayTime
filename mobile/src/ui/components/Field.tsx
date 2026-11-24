import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, ui } from '../theme';

export function Field({
    label,
    hint,
    error,
    secret,
    style,
    ...props
}: TextInputProps & { label?: string; hint?: string; error?: string; secret?: boolean }) {
    const [visible, setVisible] = useState(false);
    return (
        <View style={ui.smallStack}>
            {label ? <Text style={ui.label}>{label}</Text> : null}
            <View style={[s.inputRow, error ? { borderColor: colors.danger } : null]}>
                <TextInput
                    {...props}
                    accessibilityLabel={props.accessibilityLabel || label}
                    secureTextEntry={secret && !visible}
                    placeholderTextColor={colors.subtle}
                    selectionColor={colors.accent}
                    autoCorrect={props.autoCorrect ?? false}
                    style={[
                        s.input,
                        props.multiline && { minHeight: 88, textAlignVertical: 'top' },
                        style,
                    ]}
                />
                {secret && (
                    <Pressable
                        onPress={() => setVisible(!visible)}
                        accessibilityRole="button"
                        accessibilityLabel={visible ? 'Скрыть пароль' : 'Показать пароль'}
                        style={s.reveal}
                    >
                        <Text style={{ color: colors.accent, fontSize: 12 }}>
                            {visible ? 'Скрыть' : 'Показать'}
                        </Text>
                    </Pressable>
                )}
            </View>
            {error ? (
                <Text
                    accessibilityRole="alert"
                    style={ui.error}
                >
                    {error}
                </Text>
            ) : hint ? (
                <Text style={ui.caption}>{hint}</Text>
            ) : null}
        </View>
    );
}

const s = StyleSheet.create({
    inputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 14,
    },
    input: {
        color: colors.text,
        fontSize: 16,
        paddingHorizontal: 14,
        paddingVertical: 13,
        minHeight: 50,
        flex: 1,
    },
    reveal: { padding: 12, minHeight: 48, justifyContent: 'center' },
});
