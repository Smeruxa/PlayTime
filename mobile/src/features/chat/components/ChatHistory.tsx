import React, { useRef } from 'react';
import { FlatList, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Empty, Loading, Notice } from '../../../ui/components';
import { Icon } from '../../../ui/Icon';
import { colors, ui } from '../../../ui/theme';
import { useApp } from '../../../state/AppContext';
import { useAction } from '../../../state/useAction';
import { formatDay } from '../../../state/validation';
import type { Message } from '../../../types';
import { MessageBubble } from './MessageBubble';
import { messagesGrouped, sameMessageDay, startsUnreadMessages } from '../messageLayout';
import { ThreadEvent } from './ThreadEvent';
import { WallpaperBackdrop } from './WallpaperBackdrop';
import { UnreadMessagesDivider } from './UnreadMessagesDivider';
import { useHistoryJump } from '../hooks/useHistoryJump';
import { useHistoryFollow } from '../hooks/useHistoryFollow';

type Props = { query: string; selectedId?: number | null; onActions: (message: Message) => void };

export function ChatHistory({ query, selectedId, onActions }: Props) {
    const { client, state } = useApp();
    const action = useAction();
    const list = useRef<FlatList<Message>>(null);
    const navigation = useHistoryJump(list, selectedId);
    const messages = state.messages;
    const follow = useHistoryFollow(list, messages.at(-1), query);
    const pinned = state.messages.find((message) => message.id === state.pinnedMessageId);

    return (
        <View style={ui.fill}>
            <WallpaperBackdrop wallpaper={state.wallpaper} />
            {!!state.pinnedMessageId && (
                <Pressable
                    style={styles.pinned}
                    onPress={() => {
                        follow.pause();
                        void navigation.jump(state.pinnedMessageId!);
                    }}
                    disabled={navigation.busy}
                    accessibilityRole="button"
                >
                    <Icon
                        name="pin"
                        color={colors.accent}
                        size={17}
                    />
                    <View style={ui.fill}>
                        <Text style={styles.pinnedTitle}>Закреплённое сообщение</Text>
                        <Text
                            numberOfLines={1}
                            style={ui.caption}
                        >
                            {navigation.busy
                                ? 'Загружаем сообщение…'
                                : pinned?.text || 'Открыть сообщение'}
                        </Text>
                    </View>
                </Pressable>
            )}
            <Notice
                text={action.error || navigation.error}
                tone="error"
            />
            <FlatList
                ref={list}
                testID="message-list"
                data={messages}
                maintainVisibleContentPosition={
                    navigation.highlighted == null ? { minIndexForVisible: 0 } : undefined
                }
                onLayout={follow.followLayout}
                keyExtractor={(message) => String(message.id)}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                contentContainerStyle={[styles.content, !messages.length && { flexGrow: 1 }]}
                scrollEventThrottle={100}
                onScroll={follow.onScroll}
                onScrollBeginDrag={follow.onScrollBeginDrag}
                onMomentumScrollEnd={follow.onMomentumScrollEnd}
                onContentSizeChange={follow.followLayout}
                onScrollToIndexFailed={navigation.onScrollToIndexFailed}
                ListHeaderComponent={
                    state.hasMore ? (
                        <Button
                            title={state.historyLoading ? 'Загружаем…' : 'Предыдущие сообщения'}
                            variant="ghost"
                            disabled={state.historyLoading || action.busy}
                            onPress={() => void action.run(() => client.loadOlder())}
                        />
                    ) : messages.length ? (
                        <View style={styles.encryption}>
                            <Icon
                                name="shield"
                                size={13}
                                color={colors.subtle}
                            />
                            <Text style={ui.caption}>Сквозное шифрование</Text>
                        </View>
                    ) : undefined
                }
                ListEmptyComponent={
                    state.historyLoading ? (
                        <Loading label="Загружаем переписку…" />
                    ) : (
                        <Empty
                            title={query ? 'Совпадений нет' : 'Начните с приветствия'}
                            description={
                                query
                                    ? 'Попробуйте другой запрос или загрузите более раннюю историю.'
                                    : 'Сообщения и вложения доступны только участникам разговора.'
                            }
                        />
                    )
                }
                renderItem={({ item, index }) => {
                    const unread =
                        !!state.currentChat?.isRoom &&
                        startsUnreadMessages(item, messages[index - 1], state.roomReadWatermark);
                    return (
                        <View>
                            {(index === 0 ||
                                !sameMessageDay(item.data, messages[index - 1].data)) && (
                                <View style={styles.day}>
                                    <Text style={ui.caption}>{formatDay(item.data)}</Text>
                                </View>
                            )}
                            {unread && <UnreadMessagesDivider />}
                            {item.isThreadOp ? (
                                <ThreadEvent text={item.text} />
                            ) : (
                                <MessageBubble
                                    message={item}
                                    grouped={
                                        !unread &&
                                        messagesGrouped(
                                            item,
                                            messages[index - 1],
                                            !!state.currentChat?.isRoom,
                                        )
                                    }
                                    highlighted={
                                        item.id === selectedId || item.id === navigation.highlighted
                                    }
                                    room={!!state.currentChat?.isRoom}
                                    onLongPress={() => {
                                        Keyboard.dismiss();
                                        onActions(item);
                                    }}
                                    onReplyPress={() => {
                                        if (item.reply) {
                                            follow.pause();
                                            void navigation.jump(item.reply.id);
                                        }
                                    }}
                                    onReaction={(reaction) =>
                                        void action.run(() => client.react(item.id, reaction))
                                    }
                                />
                            )}
                        </View>
                    );
                }}
            />
            {follow.newBelow && (
                <View style={styles.latest}>
                    <Button
                        title="Новые сообщения ↓"
                        variant="secondary"
                        onPress={follow.goLatest}
                    />
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    content: { paddingHorizontal: 16, paddingVertical: 12 },
    pinned: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 20,
        paddingVertical: 10,
        backgroundColor: colors.surface,
    },
    pinnedTitle: { fontSize: 11, color: colors.accent, fontWeight: '700' },
    encryption: {
        flexDirection: 'row',
        gap: 6,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
    },
    day: {
        alignSelf: 'center',
        backgroundColor: colors.surface,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 5,
        marginVertical: 14,
    },
    latest: { position: 'absolute', bottom: 16, right: 20 },
});
