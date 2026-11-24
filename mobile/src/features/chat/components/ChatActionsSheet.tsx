import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Notice } from '../../../ui/components';
import { colors, ui } from '../../../ui/theme';
import { useApp } from '../../../state/AppContext';
import { useAction } from '../../../state/useAction';
import { confirm, native } from '../../../platform/device';
import type { Message } from '../../../types';
import { ActionRow } from './ActionRow';
import { EmojiPicker } from './EmojiPicker';
import { MuteChatAction } from './MuteChatAction';
import { CHAT_EMOJI } from '../emoji';

export type ChatActionTarget = { kind: 'chat' } | { kind: 'message'; message: Message };
type Props = {
    target: ChatActionTarget;
    onClose: () => void;
    onSearch: () => void;
    onReply: (message: Message) => void;
    onEdit: (message: Message) => void;
};

export function ChatActionsSheet({ target, onClose, onSearch, onReply, onEdit }: Props) {
    const { client, state, navigate } = useApp();
    const [allReactions, setAllReactions] = useState(false);
    const [readers, setReaders] = useState<string[] | null>(null);
    const action = useAction();
    const chat = state.currentChat;
    const message = target.kind === 'message' ? target.message : null;
    if (!chat) {
        return null;
    }
    const perform = async (operation: () => Promise<unknown>) => {
        if (await action.run(operation)) {
            onClose();
        }
    };

    return (
        <View style={styles.overlay}>
            <Pressable
                style={StyleSheet.absoluteFill}
                accessibilityLabel="Закрыть меню"
                onPress={onClose}
            />
            <View
                style={styles.sheet}
                testID="chat-action-sheet"
            >
                <View style={styles.handle} />
                <ScrollView keyboardShouldPersistTaps="handled">
                    <Notice
                        text={action.error}
                        tone="error"
                    />
                    {readers ? (
                        <View style={ui.content}>
                            <Text style={ui.heading}>Прочитали</Text>
                            {readers.length ? (
                                readers.map((name) => (
                                    <Text
                                        key={name}
                                        style={ui.text}
                                    >
                                        {name}
                                    </Text>
                                ))
                            ) : (
                                <Text style={ui.muted}>Пока никто не прочитал</Text>
                            )}
                        </View>
                    ) : target.kind === 'chat' ? (
                        <>
                            <ActionRow
                                icon="search"
                                title="Поиск в переписке"
                                onPress={() => {
                                    onSearch();
                                    onClose();
                                }}
                            />
                            <ActionRow
                                icon={chat.isRoom ? 'people' : 'person'}
                                title={
                                    chat.isRoom ? 'Участники и настройки' : 'Профиль собеседника'
                                }
                                onPress={() => {
                                    onClose();
                                    navigate(
                                        chat.isRoom
                                            ? { name: 'room' }
                                            : {
                                                  name: 'peer',
                                                  username: chat.name,
                                                  peerUserId: chat.id,
                                              },
                                    );
                                }}
                            />
                            {!chat.isRoom && !chat.archived && (
                                <ActionRow
                                    icon="image"
                                    title="Фон переписки"
                                    onPress={() => {
                                        onClose();
                                        navigate({ name: 'wallpaper' });
                                    }}
                                />
                            )}
                            <MuteChatAction chat={chat} />
                            <ActionRow
                                icon="shield"
                                title="Защита переписки"
                                onPress={() => {
                                    onClose();
                                    navigate({ name: 'account' });
                                }}
                            />
                        </>
                    ) : message && chat.archived ? (
                        <ActionRow
                            icon="copy"
                            title="Скопировать"
                            onPress={() => void perform(() => native.copyText(message.text))}
                        />
                    ) : message ? (
                        <>
                            <ScrollView
                                horizontal
                                contentContainerStyle={styles.reactions}
                                showsHorizontalScrollIndicator={false}
                            >
                                {CHAT_EMOJI.slice(0, 8).map((emoji) => (
                                    <Pressable
                                        key={emoji}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Реакция ${emoji}`}
                                        disabled={action.busy}
                                        style={styles.emoji}
                                        onPress={() =>
                                            void perform(() => client.react(message.id, emoji))
                                        }
                                    >
                                        <Text style={styles.emojiText}>{emoji}</Text>
                                    </Pressable>
                                ))}
                            </ScrollView>
                            {allReactions ? (
                                <EmojiPicker
                                    onClose={() => setAllReactions(false)}
                                    onPick={(emoji) =>
                                        void perform(() => client.react(message.id, emoji))
                                    }
                                />
                            ) : (
                                <Button
                                    title="Все эмодзи"
                                    variant="ghost"
                                    onPress={() => setAllReactions(true)}
                                />
                            )}
                            <ActionRow
                                icon="reply"
                                title="Ответить"
                                onPress={() => {
                                    onReply(message);
                                    onClose();
                                }}
                            />
                            {!!message.text && !message.decryptError && (
                                <ActionRow
                                    icon="copy"
                                    title="Скопировать"
                                    onPress={() =>
                                        void perform(() => native.copyText(message.text))
                                    }
                                />
                            )}
                            {message.me &&
                                !message.media &&
                                !message.voice &&
                                !message.attachment &&
                                !message.isThreadOp && (
                                    <ActionRow
                                        icon="edit"
                                        title="Редактировать"
                                        onPress={() => {
                                            onEdit(message);
                                            onClose();
                                        }}
                                    />
                                )}
                            <ActionRow
                                icon="pin"
                                title={
                                    state.pinnedMessageId === message.id ? 'Открепить' : 'Закрепить'
                                }
                                onPress={() =>
                                    void perform(() =>
                                        client.pin(
                                            state.pinnedMessageId === message.id
                                                ? null
                                                : message.id,
                                        ),
                                    )
                                }
                            />
                            {chat.isRoom && message.me && (
                                <ActionRow
                                    icon="people"
                                    title="Кто прочитал"
                                    onPress={() =>
                                        void action.run(async () =>
                                            setReaders(await client.readers(message.id)),
                                        )
                                    }
                                />
                            )}
                            {message.me && (
                                <ActionRow
                                    icon="trash"
                                    title="Удалить у всех"
                                    danger
                                    onPress={() =>
                                        void perform(async () => {
                                            if (
                                                await confirm(
                                                    'Удалить сообщение?',
                                                    'Оно исчезнет у всех участников.',
                                                    'Удалить',
                                                    true,
                                                )
                                            ) {
                                                await client.deleteMessage(message.id);
                                            }
                                        })
                                    }
                                />
                            )}
                        </>
                    ) : null}
                </ScrollView>
                <Button
                    title="Закрыть"
                    variant="ghost"
                    onPress={onClose}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFill,
        backgroundColor: '#00000088',
        justifyContent: 'flex-end',
    },
    sheet: {
        maxHeight: '80%',
        backgroundColor: colors.surface,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingBottom: 8,
        borderWidth: 1,
        borderColor: colors.border,
    },
    handle: {
        height: 4,
        width: 36,
        borderRadius: 3,
        backgroundColor: colors.border,
        alignSelf: 'center',
        marginTop: 10,
        marginBottom: 8,
    },
    reactions: { padding: 14, gap: 4 },
    emoji: { width: 42, height: 44, alignItems: 'center', justifyContent: 'center' },
    emojiText: { fontSize: 26 },
});
