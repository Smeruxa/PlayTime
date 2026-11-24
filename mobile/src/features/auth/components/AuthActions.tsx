import React from 'react';
import { Text, View } from 'react-native';
import { Button, Notice } from '../../../ui/components';
import { ui } from '../../../ui/theme';
import { authCopy } from '../authCopy';
import type { Authentication } from '../hooks/useAuthentication';

export function AuthActions({ form }: { form: Authentication }) {
    const { action, mode, sent, done, resendSeconds, submit, changeMode, resend, resetRecovery } =
        form;
    const copy = authCopy(mode, done, sent);
    return (
        <View style={{ gap: 16 }}>
            <Notice
                text={action.error}
                tone="error"
            />
            <Notice
                text={action.success}
                tone="success"
            />
            <Button
                testID="auth-submit"
                title={copy.submit}
                onPress={submit}
                busy={action.busy}
            />
            {mode === 'login' && (
                <Button
                    testID="auth-forgot"
                    title="Не помню пароль"
                    variant="ghost"
                    disabled={action.busy}
                    onPress={() => changeMode('recovery')}
                />
            )}
            {mode === 'verify' && (
                <Button
                    title={
                        resendSeconds > 0
                            ? `Повторить через ${resendSeconds} с`
                            : 'Отправить код ещё раз'
                    }
                    disabled={resendSeconds > 0 || action.busy}
                    variant="ghost"
                    onPress={() => void resend()}
                />
            )}
            {mode === 'recovery' && sent && (
                <>
                    <Text style={ui.caption}>
                        Для старой зашифрованной переписки понадобится перенос ключей или резервная
                        копия.
                    </Text>
                    <Button
                        title="Другой email или новый код"
                        variant="ghost"
                        disabled={action.busy}
                        onPress={resetRecovery}
                    />
                </>
            )}
        </View>
    );
}
