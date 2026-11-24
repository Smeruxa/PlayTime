import React from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Avatar, IconButton } from '../../../ui/components';
import { colors, ui } from '../../../ui/theme';
import { useApp } from '../../../state/AppContext';
import { publicImage } from '../../../platform/device';
import { MissingEncryptionKeyActions } from './MissingEncryptionKeyActions';

type Props = { onMenu: () => void; onCall: () => void };

export function ChatHeader({ onMenu, onCall }: Props) {
    const { state, back, navigate } = useApp();
    const { height } = useWindowDimensions();
    const compact = height < 500;
    const chat = state.currentChat;
    if (!chat) {
        return null;
    }
    const subtitle = chat.archived
        ? 'Гость вышел'
        : state.typingUsers.length
        ? `${state.typingUsers.join(', ')} печатает…`
        : chat.isRoom
        ? 'Комната · чат и голос'
        : state.online.includes(chat.name)
        ? 'В сети'
        : 'Не в сети';

    return (
        <View style={[styles.header, compact && styles.compact]}>
            <IconButton
                name="back"
                label="Назад к диалогам"
                testID="back"
                onPress={back}
            />
            <Pressable
                style={[ui.row, ui.fill, styles.identity]}
                accessibilityRole="button"
                onPress={() =>
                    navigate(
                        chat.isRoom
                            ? { name: 'room' }
                            : { name: 'peer', username: chat.name, peerUserId: chat.id },
                    )
                }
            >
                <Avatar
                    name={chat.name}
                    size={compact ? 32 : 38}
                    room={chat.isRoom}
                    uri={chat.archived ? undefined : publicImage(state.avatars[chat.name]?.avatar)}
                />
                <View style={ui.fill}>
                    <Text
                        numberOfLines={1}
                        style={[ui.text, styles.name]}
                    >
                        {chat.name}
                    </Text>
                    {!compact && (
                        <Text
                            numberOfLines={1}
                            style={[ui.caption, state.typingUsers.length > 0 && styles.typing]}
                        >
                            {subtitle}
                        </Text>
                    )}
                </View>
            </Pressable>
            {compact && state.encryption.needsRecovery && <MissingEncryptionKeyActions compact />}
            {!chat.archived && (
                <IconButton
                    name="phone"
                    label={chat.isRoom ? 'Войти в голосовую комнату' : 'Позвонить'}
                    testID="chat-call"
                    onPress={onCall}
                    color={colors.accent}
                />
            )}
            <IconButton
                name="more"
                label="Действия чата"
                testID="chat-menu"
                onPress={onMenu}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    compact: { paddingVertical: 0 },
    header: {
        paddingHorizontal: 4,
        paddingVertical: 9,
        flexDirection: 'row',
        alignItems: 'center',
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
    },
    identity: { gap: 10 },
    name: { fontWeight: '700' },
    typing: { color: colors.accent },
});
