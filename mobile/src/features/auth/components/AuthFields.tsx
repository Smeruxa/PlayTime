import React from 'react';
import { View } from 'react-native';
import { Field } from '../../../ui/components';
import type { Authentication } from '../hooks/useAuthentication';

export function AuthFields({ form }: { form: Authentication }) {
    const {
        mode,
        email,
        setEmail,
        username,
        setUsername,
        password,
        setPassword,
        repeat,
        setRepeat,
        code,
        setCode,
        action,
        sent,
        submit,
    } = form;
    return (
        <View style={{ gap: 16 }}>
            {mode === 'register' && (
                <Field
                    label="Никнейм"
                    testID="auth-username"
                    value={username}
                    onChangeText={setUsername}
                    maxLength={15}
                    autoCapitalize="none"
                    autoComplete="username"
                    editable={!action.busy}
                    placeholder="Как вас будут видеть друзья"
                />
            )}
            <Field
                label="Почта"
                testID="auth-email"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                maxLength={254}
                editable={!action.busy && mode !== 'verify' && !(mode === 'recovery' && sent)}
                placeholder="you@example.com"
            />
            {(mode === 'verify' || (mode === 'recovery' && sent)) && (
                <Field
                    label="Код из письма"
                    testID="auth-code"
                    value={code}
                    onChangeText={setCode}
                    keyboardType="number-pad"
                    autoCapitalize="none"
                    autoComplete="one-time-code"
                    textContentType="oneTimeCode"
                    maxLength={6}
                    editable={!action.busy}
                    placeholder="6 цифр"
                />
            )}
            {(mode === 'login' || mode === 'register' || (mode === 'recovery' && sent)) && (
                <Field
                    label={mode === 'recovery' ? 'Новый пароль' : 'Пароль'}
                    testID="auth-password"
                    secret
                    value={password}
                    onChangeText={setPassword}
                    autoCapitalize="none"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    maxLength={50}
                    editable={!action.busy}
                    onSubmitEditing={mode === 'login' ? submit : undefined}
                    returnKeyType={mode === 'login' ? 'go' : 'next'}
                    hint={mode === 'login' ? undefined : 'От 12 до 50 символов'}
                />
            )}
            {(mode === 'register' || (mode === 'recovery' && sent)) && (
                <Field
                    label="Повторите пароль"
                    testID="auth-repeat"
                    secret
                    value={repeat}
                    onChangeText={setRepeat}
                    autoCapitalize="none"
                    maxLength={50}
                    autoComplete="new-password"
                    editable={!action.busy}
                />
            )}
        </View>
    );
}
