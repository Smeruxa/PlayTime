import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useApp } from '../../../state/AppContext';
import { useAction } from '../../../state/useAction';
import type { DeviceSession } from '../../../types';
import { Button, Header, Loading, Notice } from '../../../ui/components';
import { colors, ui } from '../../../ui/theme';
import { SessionCard } from '../components/SessionCard';
import { SessionRevocation } from '../components/SessionRevocation';

export function SessionsScreen() {
    const { client, state, back } = useApp();
    const { run, busy, error, success } = useAction();
    const [sessions, setSessions] = useState<DeviceSession[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [target, setTarget] = useState<DeviceSession | 'others' | null>(null);
    const load = useCallback(
        () =>
            run(async () => {
                setSessions(await client.sessions());
                setLoaded(true);
            }),
        [client, run],
    );
    useEffect(() => {
        void load();
    }, [load]);
    const completed = async () => {
        setTarget(null);
        await run(async () => setSessions(await client.sessions()), 'Сеанс завершён');
    };
    return (
        <View style={ui.page}>
            <Header
                title={target ? 'Подтвердить отключение' : 'Устройства и сеансы'}
                onBack={target ? () => setTarget(null) : back}
            />
            <ScrollView
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                contentContainerStyle={ui.content}
                refreshControl={
                    !target ? (
                        <RefreshControl
                            refreshing={busy && loaded}
                            onRefresh={() => {
                                void load();
                            }}
                            tintColor={colors.accent}
                        />
                    ) : undefined
                }
            >
                <Notice
                    text={
                        state.connection !== 'online'
                            ? 'Нет подключения к серверу. Обновите список после восстановления сети.'
                            : null
                    }
                />
                {target ? (
                    <SessionRevocation
                        target={target}
                        onCompleted={completed}
                        onCancel={() => setTarget(null)}
                    />
                ) : (
                    <>
                        <Notice
                            text={error}
                            tone="error"
                            action={
                                <Button
                                    title="Обновить"
                                    variant="ghost"
                                    onPress={() => {
                                        void load();
                                    }}
                                    busy={busy}
                                />
                            }
                        />
                        <Notice
                            text={success}
                            tone="success"
                        />
                        {!loaded && busy ? <Loading /> : null}
                        {sessions.some((session) => !session.current) ? (
                            <Button
                                title="Завершить остальные сеансы"
                                variant="secondary"
                                disabled={busy || state.connection !== 'online'}
                                onPress={() => setTarget('others')}
                                testID="sessions-revoke-others"
                            />
                        ) : null}
                        {sessions.map((session) => (
                            <SessionCard
                                key={session.id}
                                session={session}
                                disabled={busy || state.connection !== 'online'}
                                onRevoke={() => setTarget(session)}
                            />
                        ))}
                        {loaded && sessions.length === 0 ? (
                            <Notice text="Активные сеансы не найдены. Потяните вниз, чтобы обновить список." />
                        ) : null}
                    </>
                )}
            </ScrollView>
        </View>
    );
}
