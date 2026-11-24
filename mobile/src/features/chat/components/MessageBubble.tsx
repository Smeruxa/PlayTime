import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../../ui/Icon';
import { colors, ui } from '../../../ui/theme';
import { useApp } from '../../../state/AppContext';
import { formatTime } from '../../../state/validation';
import type { Message } from '../../../types';
import { MessageMedia } from './MessageMedia';
import { replyPreview } from '../../../services/replyPreview';

export function MessageBubble({
    message: m,
    room,
    grouped = false,
    highlighted = false,
    onLongPress,
    onReplyPress,
    onReaction,
}: {
    message: Message;
    room: boolean;
    grouped?: boolean;
    highlighted?: boolean;
    onLongPress: () => void;
    onReplyPress: () => void;
    onReaction: (emoji: string) => void;
}) {
    const { state } = useApp();
    const media = m.media || m.voice?.media || m.attachment?.media;
    return (
        <View
            style={[
                s.messageRow,
                { alignItems: m.me ? 'flex-end' : 'flex-start', marginTop: grouped ? -6 : 0 },
            ]}
        >
            <Pressable
                testID={`message-${m.id}`}
                delayLongPress={350}
                onLongPress={onLongPress}
                accessibilityLabel={`Сообщение от ${m.from}: ${
                    m.text || media?.filename || 'вложение'
                }`}
                style={[
                    s.bubble,
                    { backgroundColor: m.me ? colors.outgoing : colors.surface },
                    highlighted && { borderColor: colors.accent, borderWidth: 2 },
                    grouped && {
                        borderTopLeftRadius: m.me ? 17 : 5,
                        borderTopRightRadius: m.me ? 5 : 17,
                    },
                ]}
            >
                {room && !m.me && !grouped && <Text style={s.author}>{m.from}</Text>}
                {m.reply && (
                    <Pressable
                        testID={`message-reply-${m.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Ответ ${m.reply.author}: ${replyPreview(
                            m,
                            state.messages,
                        )}`}
                        onPress={onReplyPress}
                        style={s.reply}
                    >
                        <Text style={s.author}>{m.reply.author}</Text>
                        <Text
                            numberOfLines={2}
                            style={ui.caption}
                        >
                            {replyPreview(m, state.messages)}
                        </Text>
                    </Pressable>
                )}
                {(media || m.voice || m.attachment) && <MessageMedia message={m} />}
                {!!m.text && !media && !m.voice && !m.attachment && (
                    <Text
                        style={[
                            s.messageText,
                            m.decryptError && { color: colors.warning, fontStyle: 'italic' },
                        ]}
                    >
                        {m.text}
                    </Text>
                )}
                <View style={s.meta}>
                    {m.editedAt && <Text style={s.metaText}>изм.</Text>}
                    <Text style={s.metaText}>{formatTime(m.data)}</Text>
                    {m.me && (
                        <Icon
                            name={m.read ? 'doubleCheck' : 'check'}
                            size={15}
                            color={m.read ? colors.accent : colors.muted}
                        />
                    )}
                </View>
            </Pressable>
            {!!m.reactions.length && (
                <View style={[ui.row, { gap: 5, marginTop: 4, flexWrap: 'wrap' }]}>
                    {m.reactions.map((r) => (
                        <Pressable
                            key={r.emoji}
                            onPress={() => onReaction(r.emoji)}
                            accessibilityRole="button"
                            accessibilityLabel={`Реакция ${r.emoji}: ${r.users.join(', ')}`}
                            style={[
                                s.reaction,
                                r.users.includes(state.session?.user.username || '') && {
                                    borderColor: colors.accent,
                                },
                            ]}
                        >
                            <Text style={{ fontSize: 14, color: colors.text }}>
                                {r.emoji} {r.users.length}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            )}
        </View>
    );
}

const s = StyleSheet.create({
    messageRow: { marginBottom: 10 },
    bubble: {
        maxWidth: '89%',
        minWidth: 90,
        borderRadius: 17,
        paddingHorizontal: 13,
        paddingVertical: 9,
    },
    messageText: { fontSize: 16, lineHeight: 23, color: colors.text },
    author: { fontSize: 12, fontWeight: '700', color: colors.accent, marginBottom: 4 },
    reply: {
        borderLeftWidth: 2,
        borderColor: colors.accent,
        paddingLeft: 9,
        marginBottom: 8,
        paddingVertical: 5,
        backgroundColor: '#ffffff06',
    },
    meta: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 5,
        marginTop: 5,
    },
    metaText: { fontSize: 10, color: colors.muted },
    reaction: {
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        paddingHorizontal: 9,
        paddingVertical: 5,
        minHeight: 32,
    },
    mediaIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#3aa8ff18',
        alignItems: 'center',
        justifyContent: 'center',
    },
});
