import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useApp } from '../../../state/AppContext';
import { useAction } from '../../../state/useAction';
import { ApiError } from '../../../services/http';
import { isConfirmationCode } from '../../../services/confirmationCode';
import type { DeviceSession, RevocationChallenge } from '../../../types';
import { Button, Field, Notice } from '../../../ui/components';
import { ui } from '../../../ui/theme';
import { useSecondClock } from '../hooks/useSecondClock';

export function SessionRevocation({
    target,
    onCompleted,
    onCancel,
}: {
    target: DeviceSession | 'others';
    onCompleted: () => Promise<void>;
    onCancel: () => void;
}) {
    const { client, state } = useApp();
    const action = useAction();
    const [challenge, setChallenge] = useState<RevocationChallenge | null>(null);
    const [code, setCode] = useState('');
    const [resendAt, setResendAt] = useState(0);
    const now = useSecondClock(true);
    const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000));
    const expired = !!challenge && now >= Date.parse(challenge.expiresAt);
    const sessionId = target === 'others' ? null : target.id;
    const offline = state.connection !== 'online';

    const request = () => {
        void action.run(async () => {
            let result: RevocationChallenge;
            try {
                result = await client.requestSessionRevocation(sessionId);
            } catch (error) {
                if (error instanceof ApiError && error.retryAfter) {
                    setResendAt(Date.now() + error.retryAfter * 1000);
                }
                throw error;
            }
            if (!result.challengeId || !Number.isFinite(Date.parse(result.expiresAt))) {
                throw new Error('Сервер не вернул действующий код. Повторите запрос.');
            }
            setChallenge(result);
            setResendAt(Date.now() + Math.max(0, result.retryAfter || 0) * 1000);
            setCode('');
        });
    };
    const revoke = () => {
        if (!challenge || expired || !isConfirmationCode(code)) {
            return;
        }
        void action.run(async () => {
            await client.revokeSession(sessionId, challenge.challengeId, code);
            if (target !== 'others' && target.current) {
                await client.logout();
                return;
            }
            await onCompleted();
        });
    };

    return (
        <View style={ui.stack}>
            <Text style={ui.heading}>
                {target === 'others' ? 'Отключить остальные устройства' : target.deviceName}
            </Text>
            <Text style={ui.muted}>
                {target === 'others'
                    ? 'Все остальные устройства выйдут из аккаунта. Этот сеанс останется активным.'
                    : 'Устройство выйдет из аккаунта. Для следующего входа понадобится пароль.'}
            </Text>
            <Notice
                text={
                    challenge
                        ? `Код отправлен на ${challenge.email}. Он действует 10 минут и подтверждает только это отключение.`
                        : 'Подтвердите отключение кодом с почты аккаунта.'
                }
            />
            {challenge ? (
                <Field
                    label="Код из письма · 6 цифр"
                    value={code}
                    onChangeText={setCode}
                    maxLength={6}
                    keyboardType="number-pad"
                    autoCapitalize="none"
                    autoComplete="one-time-code"
                    textContentType="oneTimeCode"
                    editable={!action.busy}
                    testID="session-code"
                    returnKeyType="done"
                    onSubmitEditing={revoke}
                />
            ) : null}
            <Notice
                text={expired ? 'Срок действия кода истёк. Запросите новый.' : action.error}
                tone="error"
            />
            {challenge ? (
                <Button
                    title="Подтвердить отключение"
                    variant="danger"
                    onPress={revoke}
                    disabled={offline || expired || !isConfirmationCode(code)}
                    busy={action.busy}
                    testID="session-confirm"
                />
            ) : null}
            <Button
                title={
                    remaining > 0
                        ? `Повторить через ${remaining} с`
                        : challenge
                        ? 'Отправить код повторно'
                        : 'Отправить код на почту'
                }
                onPress={request}
                disabled={offline || remaining > 0}
                busy={action.busy}
                variant={challenge ? 'secondary' : 'primary'}
                testID="session-request-code"
            />
            <Button
                title="Отмена"
                variant="ghost"
                onPress={onCancel}
                disabled={action.busy}
            />
        </View>
    );
}
