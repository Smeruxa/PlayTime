import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import {
    Avatar,
    Button,
    Empty,
    Field,
    Header,
    IconButton,
    Loading,
    Notice,
    SectionLabel,
} from '../../../ui/components';
import { Icon } from '../../../ui/Icon';
import { colors, ui } from '../../../ui/theme';
import { useApp } from '../../../state/AppContext';
import { useAction } from '../../../state/useAction';
import { confirm } from '../../../platform/device';
import type { RoomDetail, RoomMember } from '../../../types';

export function RoomScreen() {
    const { client, state, back } = useApp();
    const chat = state.currentChat;
    const [room, setRoom] = useState<RoomDetail | null>(null);
    const [name, setName] = useState(chat?.name || '');
    const [invite, setInvite] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);
    const [memberMenu, setMemberMenu] = useState<RoomMember | null>(null);
    const action = useAction();
    const { run } = action;
    const roomId = chat?.id;
    const load = useCallback(async () => {
        if (roomId) {
            setRoom(await client.roomMembers(roomId));
        }
    }, [client, roomId]);
    useEffect(() => {
        void run(load);
    }, [run, load, state.rooms]);
    useEffect(() => {
        if (chat?.name) {
            setName(chat.name);
        }
    }, [chat?.name]);
    if (!chat) {
        return (
            <Empty
                title="Комната недоступна"
                description="Откройте комнату из списка разговоров."
                action={
                    <Button
                        title="Назад"
                        onPress={back}
                    />
                }
            />
        );
    }
    const owner = room?.created_by === state.session?.user.id;
    const moderator =
        room?.members.find((m) => m.id === state.session?.user.id)?.role === 'moderator';
    const available = state.friends.filter(
        (f) => !room?.members.some((m) => m.username === f.friend_username),
    );
    return (
        <View
            style={ui.page}
            testID="room-settings-screen"
        >
            <Header
                title="Комната"
                onBack={back}
            />
            <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={ui.content}
            >
                <View style={[ui.row, { paddingVertical: 8 }]}>
                    <Avatar
                        name={chat.name}
                        size={66}
                        room
                    />
                    <View>
                        <Text style={ui.heading}>{chat.name}</Text>
                        <Text style={ui.muted}>
                            {room?.members.length || 0} участников ·{' '}
                            {owner ? 'вы владелец' : moderator ? 'вы модератор' : 'вы участник'}
                        </Text>
                    </View>
                </View>
                <Notice
                    text={action.error}
                    tone="error"
                />
                <Notice
                    text={action.success}
                    tone="success"
                />
                {owner && (
                    <View style={ui.card}>
                        <Field
                            testID="room-rename-input"
                            label="Название"
                            value={name}
                            onChangeText={setName}
                            maxLength={15}
                        />
                        <Button
                            title="Сохранить название"
                            testID="room-rename"
                            variant="secondary"
                            busy={action.busy}
                            onPress={() =>
                                void action.run(async () => {
                                    if (name.trim().length < 3) {
                                        throw new Error('Название — от 3 до 15 символов');
                                    }
                                    await client.updateRoom(chat.id, { name: name.trim() });
                                }, 'Название сохранено')
                            }
                        />
                    </View>
                )}
                <SectionLabel
                    right={
                        owner || moderator ? (
                            <IconButton
                                name="plus"
                                label="Пригласить участников"
                                onPress={() => setInvite(!invite)}
                                color={colors.accent}
                            />
                        ) : undefined
                    }
                >
                    Участники
                </SectionLabel>
                {!room && !action.error ? (
                    <Loading />
                ) : (
                    room?.members.map((m) => (
                        <View
                            key={m.id}
                            style={[ui.row, { paddingVertical: 7 }]}
                        >
                            <Avatar name={m.username} />
                            <View style={ui.fill}>
                                <Text style={[ui.text, { fontWeight: '600' }]}>
                                    {m.username}
                                    {m.id === state.session?.user.id ? ' · вы' : ''}
                                </Text>
                                <Text style={ui.caption}>
                                    {m.id === room.created_by
                                        ? 'Владелец'
                                        : m.role === 'moderator'
                                        ? 'Модератор'
                                        : 'Участник'}
                                </Text>
                            </View>
                            {owner && m.id !== state.session?.user.id && (
                                <IconButton
                                    name="more"
                                    label={`Управление ${m.username}`}
                                    onPress={() =>
                                        setMemberMenu(memberMenu?.id === m.id ? null : m)
                                    }
                                />
                            )}
                        </View>
                    ))
                )}
                {memberMenu && owner && (
                    <View style={ui.card}>
                        <Text style={ui.heading}>{memberMenu.username}</Text>
                        <Button
                            title={
                                memberMenu.role === 'moderator'
                                    ? 'Снять права модератора'
                                    : 'Назначить модератором'
                            }
                            variant="secondary"
                            disabled={action.busy}
                            onPress={() =>
                                void action.run(async () => {
                                    await client.setRoomRole(
                                        chat.id,
                                        memberMenu.id,
                                        memberMenu.role === 'moderator' ? 'member' : 'moderator',
                                    );
                                    setMemberMenu(null);
                                    await load();
                                })
                            }
                        />
                        <Button
                            title="Передать владение"
                            variant="secondary"
                            disabled={action.busy}
                            onPress={() =>
                                void action.run(async () => {
                                    if (
                                        !(await confirm(
                                            'Передать комнату?',
                                            `${memberMenu.username} станет владельцем. Вы потеряете права управления.`,
                                            'Передать',
                                        ))
                                    ) {
                                        return;
                                    }
                                    await client.transferRoomOwnership(chat.id, memberMenu.id);
                                    setMemberMenu(null);
                                    await load();
                                })
                            }
                        />
                        <Button
                            title="Удалить участника"
                            variant="danger"
                            disabled={action.busy}
                            onPress={() =>
                                void action.run(async () => {
                                    if (
                                        !(await confirm(
                                            'Удалить участника?',
                                            `${memberMenu.username} потеряет доступ к комнате.`,
                                            'Удалить',
                                            true,
                                        ))
                                    ) {
                                        return;
                                    }
                                    await client.removeRoomMember(chat.id, memberMenu.id);
                                    setMemberMenu(null);
                                    await load();
                                })
                            }
                        />
                    </View>
                )}
                {(owner || moderator) && (
                    <Button
                        title={invite ? 'Скрыть приглашения' : 'Добавить участников'}
                        testID="room-invite"
                        variant="secondary"
                        icon="plus"
                        onPress={() => setInvite(!invite)}
                    />
                )}
                {invite && (
                    <View style={ui.card}>
                        <Text style={ui.heading}>Пригласить друзей</Text>
                        <Text style={ui.caption}>
                            Доступно мест:{' '}
                            {Math.max(
                                0,
                                (state.subscription?.limits.maxRoomMembers || 10) -
                                    (room?.members.length || 0),
                            )}
                        </Text>
                        {available.length ? (
                            available.map((f) => (
                                <Pressable
                                    key={f.friend_id}
                                    accessibilityRole="checkbox"
                                    accessibilityLabel={f.friend_username}
                                    accessibilityState={{
                                        checked: selected.includes(f.friend_username),
                                    }}
                                    onPress={() =>
                                        setSelected((v) =>
                                            v.includes(f.friend_username)
                                                ? v.filter((n) => n !== f.friend_username)
                                                : [...v, f.friend_username],
                                        )
                                    }
                                    style={[ui.row, { minHeight: 56 }]}
                                >
                                    <Avatar
                                        size={36}
                                        name={f.friend_username}
                                    />
                                    <Text style={[ui.text, ui.fill]}>{f.friend_username}</Text>
                                    <Icon
                                        name={
                                            selected.includes(f.friend_username) ? 'check' : 'plus'
                                        }
                                        color={
                                            selected.includes(f.friend_username)
                                                ? colors.accent
                                                : colors.muted
                                        }
                                    />
                                </Pressable>
                            ))
                        ) : (
                            <Text style={ui.muted}>Все ваши друзья уже в комнате.</Text>
                        )}
                        <Button
                            title={`Пригласить${selected.length ? ` · ${selected.length}` : ''}`}
                            testID="room-invite-submit"
                            disabled={!selected.length}
                            busy={action.busy}
                            onPress={() =>
                                void action.run(async () => {
                                    await client.addRoomMembers(chat.id, selected);
                                    setSelected([]);
                                    setInvite(false);
                                    await load();
                                }, 'Приглашения отправлены')
                            }
                        />
                    </View>
                )}
                <View style={ui.divider} />
                <Button
                    title={owner ? 'Удалить комнату' : 'Покинуть комнату'}
                    variant="danger"
                    testID="room-leave"
                    busy={action.busy}
                    onPress={() =>
                        void action.run(async () => {
                            if (
                                !(await confirm(
                                    owner ? 'Удалить комнату для всех?' : 'Покинуть комнату?',
                                    owner
                                        ? 'История и доступ участников будут удалены. Это действие нельзя отменить.'
                                        : 'Вы потеряете доступ к чату и голосовой комнате.',
                                    owner ? 'Удалить' : 'Покинуть',
                                    true,
                                ))
                            ) {
                                return;
                            }
                            if (owner) {
                                await client.deleteRoom(chat.id);
                            } else {
                                await client.leaveRoom(chat.id);
                            }
                            back();
                            back();
                        })
                    }
                />
                {action.error && !room && (
                    <Button
                        title="Повторить загрузку"
                        onPress={() => void action.run(load)}
                    />
                )}
            </ScrollView>
        </View>
    );
}
