import React from 'react';
import { Text, View } from 'react-native';
import type { DeviceSession } from '../../../types';
import { Button } from '../../../ui/components';
import { colors, ui } from '../../../ui/theme';

function dateLabel(value: string) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString('ru-RU') : 'Нет данных';
}

export function SessionCard({
    session,
    disabled,
    onRevoke,
}: {
    session: DeviceSession;
    disabled: boolean;
    onRevoke: () => void;
}) {
    return (
        <View
            style={ui.card}
            testID={`session-${session.id}`}
        >
            <Text style={ui.heading}>{session.deviceName || 'Устройство'}</Text>
            {session.current ? (
                <Text style={[ui.label, { color: colors.success }]}>Это устройство</Text>
            ) : null}
            <Text style={ui.caption}>Последняя активность: {dateLabel(session.lastSeenAt)}</Text>
            <Text style={ui.caption}>Вход: {dateLabel(session.createdAt)}</Text>
            <Button
                title={session.current ? 'Завершить этот сеанс' : 'Отключить устройство'}
                variant="danger"
                disabled={disabled}
                onPress={onRevoke}
                testID={`session-revoke-${session.id}`}
            />
        </View>
    );
}
