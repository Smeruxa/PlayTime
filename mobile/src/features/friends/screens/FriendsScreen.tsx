import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import {
    Avatar,
    Button,
    ChoiceChips,
    Empty,
    Field,
    Header,
    IconButton,
    Notice,
    SearchField,
    SectionLabel,
} from '../../../ui/components';
import { Icon } from '../../../ui/Icon';
import { colors, ui } from '../../../ui/theme';
import { useApp } from '../../../state/AppContext';
import { useAction } from '../../../state/useAction';
import { confirm, publicImage } from '../../../platform/device';
import type { Friend } from '../../../types';

export function FriendsScreen() {
    const { state, client, openChat, navigate } = useApp();
    const [filter, setFilter] = useState<'friends' | 'requests'>('friends');
    const [query, setQuery] = useState('');
    const [username, setUsername] = useState('');
    const action = useAction();
    const friendChat = (f: Friend) =>
        openChat({
            id: f.friend_id,
            name: f.friend_username,
            isRoom: false,
            archived: !!f.friend_archived,
        });
    const send = () =>
        action.run(async () => {
            if (!username.trim()) {
                throw new Error('Введите никнейм друга');
            }
            await client.friendAction('request', username.trim());
            setUsername('');
        }, 'Заявка отправлена');
    return (
        <View
            style={ui.page}
            testID="friends-screen"
        >
            <Header
                title="Друзья"
                subtitle={`${
                    state.online.filter((n) => state.friends.some((f) => f.friend_username === n))
                        .length
                } в сети · ${state.friends.length} всего`}
            />
            <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={ui.content}
                refreshControl={
                    <RefreshControl
                        refreshing={action.busy}
                        onRefresh={() => void action.run(() => client.refreshHome())}
                        colors={[colors.accent]}
                    />
                }
            >
                <View style={ui.card}>
                    <View style={ui.row}>
                        <Icon
                            name="people"
                            color={colors.accent}
                        />
                        <Text style={ui.heading}>Добавить друга</Text>
                    </View>
                    <Text style={ui.muted}>Найдите друг друга по точному никнейму.</Text>
                    <Field
                        testID="friend-username"
                        accessibilityLabel="Никнейм друга"
                        placeholder="Никнейм"
                        value={username}
                        onChangeText={setUsername}
                        maxLength={50}
                        autoCapitalize="none"
                        onSubmitEditing={send}
                        returnKeyType="send"
                    />
                    <Button
                        testID="friend-request"
                        title="Отправить заявку"
                        icon="plus"
                        onPress={send}
                        busy={action.busy}
                    />
                </View>
                <Notice
                    text={action.error}
                    tone="error"
                />
                <Notice
                    text={action.success}
                    tone="success"
                />
                <ChoiceChips
                    value={filter}
                    onChange={setFilter}
                    options={[
                        { value: 'friends', label: `Друзья · ${state.friends.length}` },
                        {
                            value: 'requests',
                            label: `Заявки · ${state.incoming.length + state.outgoing.length}`,
                        },
                    ]}
                />
                {filter === 'friends' ? (
                    <>
                        <SearchField
                            value={query}
                            onChangeText={setQuery}
                            placeholder="Найти друга"
                        />
                        {state.friends
                            .filter((f) =>
                                f.friend_username
                                    .toLowerCase()
                                    .includes(query.trim().toLowerCase()),
                            )
                            .map((f) => (
                                <View
                                    key={f.friend_id}
                                    style={[ui.row, { paddingVertical: 8 }]}
                                >
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={`Профиль ${f.friend_username}`}
                                        onPress={() =>
                                            navigate({
                                                name: 'peer',
                                                username: f.friend_username,
                                                peerUserId: f.friend_id,
                                            })
                                        }
                                    >
                                        <Avatar
                                            name={f.friend_username}
                                            uri={publicImage(
                                                f.friend_archived
                                                    ? undefined
                                                    : state.avatars[f.friend_username]?.avatar,
                                            )}
                                            effect={
                                                f.friend_archived
                                                    ? undefined
                                                    : state.avatars[f.friend_username]
                                                          ?.profileAvatarEffect
                                            }
                                            online={
                                                !f.friend_archived &&
                                                state.online.includes(f.friend_username)
                                            }
                                        />
                                    </Pressable>
                                    <Pressable
                                        style={ui.fill}
                                        onPress={() => friendChat(f)}
                                        accessibilityRole="button"
                                    >
                                        <Text style={[ui.text, { fontWeight: '600' }]}>
                                            {f.friend_username}
                                        </Text>
                                        <Text style={ui.caption}>
                                            {f.friend_archived
                                                ? 'Гость вышел'
                                                : state.online.includes(f.friend_username)
                                                ? 'В сети'
                                                : 'Не в сети'}
                                        </Text>
                                    </Pressable>
                                    <IconButton
                                        name="chat"
                                        label={`Написать ${f.friend_username}`}
                                        onPress={() => friendChat(f)}
                                        color={colors.accent}
                                    />
                                </View>
                            ))}
                        {!!state.friends.length &&
                            !state.friends.some((friend) =>
                                friend.friend_username
                                    .toLocaleLowerCase()
                                    .includes(query.trim().toLocaleLowerCase()),
                            ) && (
                                <Empty
                                    title="Никого не найдено"
                                    description="Попробуйте другой никнейм."
                                />
                            )}
                        {!state.friends.length && (
                            <Empty
                                icon="people"
                                title="Друзья скоро появятся"
                                description="Отправьте первую заявку по никнейму."
                            />
                        )}
                    </>
                ) : (
                    <>
                        <SectionLabel>Входящие · {state.incoming.length}</SectionLabel>
                        {state.incoming.map((f) => (
                            <View
                                key={f.friend_id}
                                style={ui.card}
                            >
                                <View style={ui.row}>
                                    <Avatar name={f.friend_username} />
                                    <Text style={[ui.text, ui.fill]}>{f.friend_username}</Text>
                                </View>
                                <View style={ui.row}>
                                    <Button
                                        title="Принять"
                                        testID={`accept-${f.friend_username}`}
                                        style={ui.fill}
                                        disabled={action.busy}
                                        onPress={() =>
                                            void action.run(() =>
                                                client.friendAction(
                                                    'accept',
                                                    f.friend_username,
                                                    f.friend_id,
                                                ),
                                            )
                                        }
                                    />
                                    <Button
                                        title="Отклонить"
                                        variant="secondary"
                                        style={ui.fill}
                                        disabled={action.busy}
                                        onPress={() =>
                                            void action.run(() =>
                                                client.friendAction(
                                                    'decline',
                                                    f.friend_username,
                                                    f.friend_id,
                                                ),
                                            )
                                        }
                                    />
                                </View>
                                <Button
                                    title="Заблокировать"
                                    variant="ghost"
                                    disabled={action.busy}
                                    testID={`block-request-${f.friend_username}`}
                                    onPress={() =>
                                        void action.run(async () => {
                                            if (
                                                await confirm(
                                                    'Заблокировать пользователя?',
                                                    `${f.friend_username} больше не сможет писать, звонить или отправлять заявки.`,
                                                    'Заблокировать',
                                                    true,
                                                )
                                            ) {
                                                await client.safety(
                                                    f.friend_username,
                                                    'block',
                                                    undefined,
                                                    f.friend_id,
                                                );
                                            }
                                        })
                                    }
                                />
                            </View>
                        ))}
                        {!state.incoming.length && (
                            <Text style={ui.muted}>Новых заявок пока нет.</Text>
                        )}
                        <SectionLabel>Отправленные · {state.outgoing.length}</SectionLabel>
                        {(state.outgoingPeers ?? []).map((peer) => {
                            const name = peer.friend_username;
                            return (
                                <View
                                    key={name}
                                    style={ui.row}
                                >
                                    <Avatar name={name} />
                                    <View style={ui.fill}>
                                        <Text style={ui.text}>{name}</Text>
                                        <Text style={ui.caption}>Ждём ответа</Text>
                                    </View>
                                    <Button
                                        title="Отменить"
                                        variant="ghost"
                                        disabled={action.busy}
                                        onPress={() =>
                                            void action.run(async () => {
                                                if (
                                                    await confirm(
                                                        'Отменить заявку?',
                                                        `Заявка пользователю ${name} будет отменена.`,
                                                        'Отменить заявку',
                                                    )
                                                ) {
                                                    await client.friendAction(
                                                        'decline',
                                                        name,
                                                        peer.friend_id,
                                                    );
                                                }
                                            })
                                        }
                                    />
                                </View>
                            );
                        })}
                    </>
                )}
            </ScrollView>
        </View>
    );
}
