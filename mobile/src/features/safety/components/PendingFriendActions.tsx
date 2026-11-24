import React from 'react';
import { Text, View } from 'react-native';
import { Button } from '../../../ui/components';
import { ui } from '../../../ui/theme';

type Props = {
    incoming: boolean;
    busy: boolean;
    onAccept: () => void;
    onDecline: () => void;
};

export function PendingFriendActions({ incoming, busy, onAccept, onDecline }: Props) {
    return (
        <View
            style={ui.card}
            testID="peer-pending-friendship"
        >
            <Text style={ui.text}>
                {incoming ? 'Хочет добавить вас в друзья' : 'Заявка отправлена. Ждём ответа.'}
            </Text>
            {incoming && (
                <Button
                    title="Принять заявку"
                    disabled={busy}
                    onPress={onAccept}
                />
            )}
            <Button
                title={incoming ? 'Отклонить заявку' : 'Отменить заявку'}
                variant="secondary"
                disabled={busy}
                onPress={onDecline}
            />
        </View>
    );
}
