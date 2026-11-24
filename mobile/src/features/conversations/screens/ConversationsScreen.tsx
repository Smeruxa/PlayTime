import { chatKey } from '../../../services/chatIdentity';
import React, { useMemo, useState } from 'react';
import { FlatList, Keyboard, RefreshControl, StyleSheet, View } from 'react-native';
import { Button, Empty, Header, IconButton, Notice } from '../../../ui/components';
import { colors, ui } from '../../../ui/theme';
import { useApp } from '../../../state/AppContext';
import { useAction } from '../../../state/useAction';
import type { ChatRef } from '../../../types';
import { ConversationRow } from '../components/ConversationRow';
import { ConversationSearch } from '../components/ConversationSearch';

export function ConversationsScreen({ roomsOnly = false }: { roomsOnly?: boolean }) {
    const { client, state, openChat, navigate, setTab } = useApp();
    const [query, setQuery] = useState('');
    const [searchVisible, setSearchVisible] = useState(false);
    const action = useAction();
    const chats = useMemo(() => {
        const all: ChatRef[] = [
            ...state.rooms.map((r) => ({
                id: r.id,
                name: r.name,
                isRoom: true,
                createdBy: r.created_by,
            })),
            ...(!roomsOnly
                ? state.friends.map((f) => ({
                      id: f.friend_id,
                      name: f.friend_username,
                      isRoom: false,
                      archived: !!f.friend_archived,
                  }))
                : []),
        ];
        const normalizedQuery = query.trim().toLocaleLowerCase();
        return all
            .filter((conversation) => {
                const preview = state.previews[chatKey(conversation)]?.text || '';
                return [conversation.name, preview].some((value) =>
                    value.toLocaleLowerCase().includes(normalizedQuery),
                );
            })
            .sort(
                (a, b) =>
                    (state.previews[chatKey(b)]?.date || 0) -
                    (state.previews[chatKey(a)]?.date || 0),
            );
    }, [state.rooms, state.friends, state.previews, roomsOnly, query]);

    const toggleSearch = () => {
        if (searchVisible) {
            Keyboard.dismiss();
            setQuery('');
        }
        setSearchVisible((visible) => !visible);
    };
    return (
        <View
            style={ui.page}
            testID={roomsOnly ? 'rooms-screen' : 'chats-screen'}
        >
            <Header
                title={roomsOnly ? 'Комнаты' : 'Диалоги'}
                subtitle={roomsOnly ? 'Место для вашей компании' : undefined}
                right={
                    <View style={s.actions}>
                        <IconButton
                            name={searchVisible ? 'close' : 'search'}
                            label={searchVisible ? 'Закрыть поиск' : 'Поиск'}
                            testID="conversation-search-toggle"
                            selected={searchVisible}
                            onPress={toggleSearch}
                        />
                        <IconButton
                            name="plus"
                            label={roomsOnly ? 'Создать комнату' : 'Новый диалог'}
                            testID="new-conversation"
                            onPress={() =>
                                roomsOnly ? navigate({ name: 'createRoom' }) : setTab('friends')
                            }
                            color={colors.accent}
                        />
                    </View>
                }
            />
            <ConversationSearch
                visible={searchVisible}
                query={query}
                onChangeQuery={setQuery}
                roomsOnly={roomsOnly}
            />
            {!!action.error && (
                <View style={s.notice}>
                    <Notice
                        text={action.error}
                        tone="error"
                    />
                </View>
            )}
            <FlatList
                data={chats}
                keyExtractor={(c) => `${c.isRoom ? 'r' : 'd'}${c.id}`}
                renderItem={({ item }) => (
                    <ConversationRow
                        chat={item}
                        preview={state.previews[chatKey(item)]}
                        avatar={state.avatars[item.name]}
                        online={state.online.includes(item.name)}
                        onOpen={openChat}
                    />
                )}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                contentContainerStyle={chats.length ? { paddingBottom: 20 } : { flexGrow: 1 }}
                refreshControl={
                    <RefreshControl
                        refreshing={action.busy}
                        onRefresh={() => void action.run(() => client.refreshHome())}
                        tintColor={colors.accent}
                        colors={[colors.accent]}
                    />
                }
                ListEmptyComponent={
                    <Empty
                        icon={roomsOnly ? 'room' : 'chat'}
                        title={
                            query
                                ? 'Ничего не найдено'
                                : roomsOnly
                                ? 'Соберите своих'
                                : 'Ваши диалоги здесь'
                        }
                        description={
                            query
                                ? 'Попробуйте другое имя или название.'
                                : roomsOnly
                                ? 'Создайте комнату, пригласите друзей и общайтесь в чате или голосом.'
                                : 'Добавьте друга по никнейму, чтобы начать переписку или позвонить.'
                        }
                        action={
                            !query ? (
                                <Button
                                    title={roomsOnly ? 'Создать комнату' : 'Найти друзей'}
                                    icon="plus"
                                    onPress={() =>
                                        roomsOnly
                                            ? navigate({ name: 'createRoom' })
                                            : setTab('friends')
                                    }
                                />
                            ) : undefined
                        }
                    />
                }
            />
        </View>
    );
}

const s = StyleSheet.create({
    actions: { flexDirection: 'row' },
    notice: { paddingHorizontal: 20, paddingBottom: 16 },
});
