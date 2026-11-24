import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Loading } from '../../../ui/components';
import { Icon } from '../../../ui/Icon';
import { colors, ui } from '../../../ui/theme';
import type { PlayTimeClient } from '../../../services/client';
import { useAuthentication } from '../hooks/useAuthentication';
import { useAuthErrorReveal } from '../hooks/useAuthErrorReveal';
import { AuthHeader } from '../components/AuthHeader';
import { AuthFields } from '../components/AuthFields';
import { AuthLegalConsent } from '../components/AuthLegalConsent';
import { AuthActions } from '../components/AuthActions';

export function AuthScreen({ client }: { client: PlayTimeClient }) {
    const form = useAuthentication(client);
    const { scroll, revealError } = useAuthErrorReveal(form.action.error);
    if (!form.ready) {
        return <Loading label="Открываем форму…" />;
    }
    return (
        <ScrollView
            ref={scroll}
            onContentSizeChange={revealError}
            testID="auth-screen"
            style={ui.page}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.content}
        >
            <AuthHeader form={form} />
            {!form.done && (
                <View style={{ gap: 16 }}>
                    <AuthFields form={form} />
                    {form.mode === 'register' && <AuthLegalConsent form={form} />}
                    <AuthActions form={form} />
                </View>
            )}
            {(form.mode === 'login' || form.done) && (
                <View style={styles.footer}>
                    {!form.done && (
                        <Text style={[ui.muted, { textAlign: 'center' }]}>Ещё не с нами?</Text>
                    )}
                    <Button
                        testID="auth-register"
                        title={form.done ? 'Перейти ко входу' : 'Создать аккаунт'}
                        variant="secondary"
                        disabled={form.action.busy}
                        onPress={() => form.changeMode(form.done ? 'login' : 'register')}
                    />
                </View>
            )}
            <View style={styles.privacy}>
                <Icon
                    name="shield"
                    size={15}
                    color={colors.subtle}
                />
                <Text style={ui.caption}>Личные разговоры зашифрованы</Text>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    content: { flexGrow: 1, padding: 28, paddingTop: 22, paddingBottom: 28, gap: 24 },
    footer: { gap: 12 },
    privacy: { flexDirection: 'row', gap: 10, justifyContent: 'center', marginTop: 8 },
});
