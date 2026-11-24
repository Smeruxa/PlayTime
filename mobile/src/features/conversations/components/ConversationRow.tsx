import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../../ui/components';
import { colors, ui } from '../../../ui/theme';
import { publicImage } from '../../../platform/device';
import { formatTime } from '../../../state/validation';
import type { ChatRef, ClientSnapshot, Preview } from '../../../types';

type Props = {
    chat: ChatRef;
    preview?: Preview;
    avatar?: ClientSnapshot['avatars'][string];
    online: boolean;
    onOpen: (chat: ChatRef) => void;
};

export function ConversationRow({ chat, preview, avatar, online, onOpen }: Props) {
    return (
        <Pressable
            testID={`chat-${chat.isRoom ? 'room-' : ''}${chat.name}`}
            accessibilityRole="button"
            accessibilityLabel={`${chat.isRoom ? 'Комната' : 'Чат'} ${chat.name}${
                preview?.unread ? `, ${preview.unread} непрочитанных` : ''
            }`}
            onPress={() => onOpen(chat)}
            style={({ pressed }) => [
                s.conversation,
                { backgroundColor: pressed ? colors.surface : colors.bg },
            ]}
        >
            <Avatar
                name={chat.name}
                uri={chat.archived ? undefined : publicImage(avatar?.avatar)}
                effect={chat.archived ? undefined : avatar?.profileAvatarEffect}
                size={54}
                room={chat.isRoom}
                online={chat.isRoom || chat.archived ? undefined : online}
            />
            <View style={[ui.fill, { gap: 7 }]}>
                <View style={ui.between}>
                    <Text
                        numberOfLines={1}
                        style={[s.chatName, ui.fill]}
                    >
                        {chat.name}
                    </Text>
                    <Text style={ui.caption}>{preview?.date ? formatTime(preview.date) : ''}</Text>
                </View>
                <View style={ui.between}>
                    <Text
                        numberOfLines={1}
                        style={[ui.muted, ui.fill]}
                    >
                        {chat.archived
                            ? 'Гость вышел'
                            : preview?.text ||
                              (chat.isRoom ? 'Ваша комната для разговоров' : 'Начните разговор')}
                    </Text>
                    {!!preview?.unread && (
                        <View style={s.unread}>
                            <Text style={s.unreadText}>
                                {preview.unread > 99 ? '99+' : preview.unread}
                            </Text>
                        </View>
                    )}
                </View>
            </View>
        </Pressable>
    );
}

const s = StyleSheet.create({
    conversation: {
        paddingVertical: 16,
        paddingHorizontal: 20,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    chatName: { fontSize: 16, fontWeight: '600', color: colors.text },
    unread: {
        backgroundColor: colors.accent,
        minWidth: 21,
        minHeight: 21,
        borderRadius: 99,
        paddingHorizontal: 6,
        paddingVertical: 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    unreadText: { fontSize: 11, fontWeight: '700', color: '#071C2D' },
});
