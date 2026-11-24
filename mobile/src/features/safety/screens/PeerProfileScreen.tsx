import React, { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button, Field, Header, Loading, Notice } from '../../../ui/components';
import { ui } from '../../../ui/theme';
import { useApp } from '../../../state/AppContext';
import { useAction } from '../../../state/useAction';
import { useResource } from '../../../state/useResource';
import { confirm } from '../../../platform/device';
import { ProfilePreview } from '../../profile/components/ProfilePreview';
import { PendingFriendActions } from '../components/PendingFriendActions';

export function PeerProfileScreen({
    username,
    peerUserId,
}: {
    username: string;
    peerUserId?: number;
}) {
    const { client, state, back, openChat, calls, showCall } = useApp();
    const loader = useCallback(
        async () => ({
            profile: await client.getProfile(username, peerUserId),
            blocked: (await client.blockedUsers()).includes(username),
        }),
        [client, username, peerUserId],
    );
    const resource = useResource(loader);
    const action = useAction();
    const [reporting, setReporting] = useState(false);
    const [reason, setReason] = useState('');
    const friend = state.friends.find(
        (item) =>
            (peerUserId ? item.friend_id === peerUserId : item.friend_username === username) &&
            item.status === 'accepted',
    );
    const incoming = state.incoming.some((item) =>
        peerUserId ? item.friend_id === peerUserId : item.friend_username === username,
    );
    const outgoing = (state.outgoingPeers ?? []).some((item) =>
        peerUserId ? item.friend_id === peerUserId : item.friend_username === username,
    );

    return (
        <View
            style={ui.page}
            testID="peer-profile-screen"
        >
            <Header
                title="Профиль"
                onBack={back}
            />
            <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={ui.content}
            >
                {resource.loading ? (
                    <Loading />
                ) : resource.data ? (
                    <ProfilePreview profile={resource.data.profile} />
                ) : (
                    <Notice
                        text={resource.error}
                        tone="error"
                        action={
                            <Button
                                title="Повторить"
                                onPress={() => void resource.reload()}
                            />
                        }
                    />
                )}
                {resource.data?.profile.archived && <Notice text="Гость вышел" />}
                {friend && !resource.data?.blocked && (
                    <View style={ui.row}>
                        <Button
                            title="Написать"
                            icon="chat"
                            style={ui.fill}
                            onPress={() =>
                                openChat({
                                    id: friend.friend_id,
                                    name: username,
                                    isRoom: false,
                                    archived: !!friend.friend_archived,
                                })
                            }
                        />
                        <Button
                            title="Позвонить"
                            disabled={!!resource.data?.profile.archived}
                            icon="phone"
                            variant="secondary"
                            style={ui.fill}
                            onPress={() =>
                                void action.run(async () => {
                                    if (!calls) {
                                        throw new Error('Соединение ещё не готово');
                                    }
                                    if (resource.data?.profile.archived) {
                                        throw new Error('Гость вышел');
                                    }
                                    await calls.start(username, peerUserId);
                                    showCall();
                                })
                            }
                        />
                    </View>
                )}
                {!friend && !resource.data?.blocked && (incoming || outgoing) && (
                    <PendingFriendActions
                        incoming={incoming}
                        busy={action.busy}
                        onAccept={() =>
                            void action.run(() =>
                                client.friendAction('accept', username, peerUserId),
                            )
                        }
                        onDecline={() =>
                            void action.run(() =>
                                client.friendAction('decline', username, peerUserId),
                            )
                        }
                    />
                )}
                {!friend &&
                    !incoming &&
                    !outgoing &&
                    !resource.data?.blocked &&
                    !resource.data?.profile.archived && (
                        <Button
                            title="Добавить в друзья"
                            icon="plus"
                            busy={action.busy}
                            onPress={() =>
                                void action.run(
                                    () => client.friendAction('request', username),
                                    'Заявка отправлена',
                                )
                            }
                        />
                    )}
                <View style={ui.card}>
                    <Text style={ui.heading}>Общение</Text>
                    {friend && (
                        <Button
                            title="Удалить из друзей"
                            variant="secondary"
                            disabled={action.busy}
                            onPress={() =>
                                void action.run(async () => {
                                    if (
                                        await confirm(
                                            'Удалить из друзей?',
                                            `${username} исчезнет из списка друзей.`,
                                            'Удалить',
                                            true,
                                        )
                                    ) {
                                        await client.friendAction('remove', username, peerUserId);
                                    }
                                })
                            }
                        />
                    )}
                    <Button
                        title={resource.data?.blocked ? 'Разблокировать' : 'Заблокировать'}
                        variant="danger"
                        disabled={action.busy || resource.loading}
                        onPress={() =>
                            void action.run(
                                async () => {
                                    const blocked = resource.data?.blocked;
                                    if (
                                        !blocked &&
                                        !(await confirm(
                                            `Заблокировать ${username}?`,
                                            'Личные сообщения, звонки и заявки будут остановлены.',
                                            'Заблокировать',
                                            true,
                                        ))
                                    ) {
                                        return;
                                    }
                                    await client.safety(
                                        username,
                                        blocked ? 'unblock' : 'block',
                                        undefined,
                                        peerUserId,
                                    );
                                    resource.setData((current) =>
                                        current ? { ...current, blocked: !blocked } : current,
                                    );
                                },
                                resource.data?.blocked
                                    ? 'Блокировка снята. Можно добавить друга снова.'
                                    : 'Пользователь заблокирован',
                            )
                        }
                    />
                    <Button
                        title="Пожаловаться"
                        variant="ghost"
                        onPress={() => setReporting(!reporting)}
                    />
                    {reporting && (
                        <>
                            <Field
                                label="Причина жалобы"
                                testID="report-reason"
                                value={reason}
                                onChangeText={setReason}
                                multiline
                                maxLength={1000}
                                hint="От 5 до 1000 символов"
                            />
                            <Text style={ui.caption}>
                                Администратор увидит описание и имена участников. Содержимое
                                переписки не передаётся автоматически.
                            </Text>
                            <Button
                                title="Отправить жалобу"
                                testID="report-submit"
                                busy={action.busy}
                                disabled={reason.trim().length < 5}
                                onPress={() =>
                                    void action.run(async () => {
                                        await client.safety(
                                            username,
                                            'report',
                                            reason.trim(),
                                            peerUserId,
                                        );
                                        setReporting(false);
                                        setReason('');
                                    }, 'Жалоба передана администратору')
                                }
                            />
                        </>
                    )}
                </View>
                <Notice
                    text={action.error}
                    tone="error"
                />
                <Notice
                    text={action.success}
                    tone="success"
                />
            </ScrollView>
        </View>
    );
}
