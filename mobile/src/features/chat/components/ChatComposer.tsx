import React from 'react';
import { Keyboard, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Button, IconButton, Notice } from '../../../ui/components';
import { Icon } from '../../../ui/Icon';
import { colors, ui } from '../../../ui/theme';
import type { useChatComposer } from '../hooks/useChatComposer';
import { EmojiPicker } from './EmojiPicker';
import { VoiceRecordingPreview } from './VoiceRecordingPreview';
import { AttachmentPreview } from './AttachmentPreview';

type Props = {
    composer: ReturnType<typeof useChatComposer>;
    enabled: boolean;
    connected: boolean;
};

export function ChatComposer({ composer, enabled, connected }: Props) {
    const { voice, edit, reply } = composer;
    const { height } = useWindowDimensions();
    const compact = height < 500;
    return (
        <View>
            <Notice
                text={composer.error}
                tone="error"
                action={
                    <Button
                        title="Понятно"
                        variant="ghost"
                        onPress={composer.clearError}
                    />
                }
            />
            {voice.pending && (
                <VoiceRecordingPreview
                    file={voice.pending}
                    busy={voice.busy}
                    disabled={!connected}
                    onSend={() => void voice.send()}
                    onCancel={() => void voice.cancel()}
                />
            )}
            {composer.attachment.file && (
                <AttachmentPreview
                    file={composer.attachment.file}
                    busy={composer.attachment.busy}
                    disabled={!connected}
                    onSend={() => void composer.attachment.send()}
                    onCancel={() => void composer.attachment.cancel()}
                />
            )}
            {(reply || edit) && (
                <View style={styles.reference}>
                    <Icon
                        name={edit ? 'edit' : 'reply'}
                        color={colors.accent}
                        size={18}
                    />
                    <View style={ui.fill}>
                        <Text style={styles.referenceTitle}>
                            {edit ? 'Редактирование' : `Ответ ${reply?.from}`}
                        </Text>
                        <Text
                            numberOfLines={1}
                            style={ui.caption}
                        >
                            {(edit || reply)?.text || 'Вложение'}
                        </Text>
                    </View>
                    <IconButton
                        name="close"
                        label="Отменить ответ или редактирование"
                        onPress={composer.cancelReference}
                    />
                </View>
            )}
            {composer.emojiOpen && (
                <EmojiPicker
                    onPick={(emoji) => composer.setText((composer.text + emoji).slice(0, 2000))}
                    onClose={() => composer.setEmojiOpen(false)}
                />
            )}
            <View
                style={[styles.composer, compact && styles.compactComposer]}
                testID="chat-composer"
            >
                {voice.recording ? (
                    <>
                        <View style={styles.recordDot} />
                        <Text style={[ui.text, ui.fill]}>
                            Запись · {Math.floor(voice.elapsed / 60)}:
                            {String(voice.elapsed % 60).padStart(2, '0')}
                        </Text>
                        <IconButton
                            name="trash"
                            label="Отменить запись"
                            onPress={() => void voice.cancel()}
                            color={colors.danger}
                        />
                        <IconButton
                            name="check"
                            label="Завершить запись и прослушать"
                            testID="voice-stop"
                            onPress={() => void voice.stop()}
                            color={colors.accent}
                        />
                        <IconButton
                            name="send"
                            label="Отправить голосовое сообщение"
                            testID="voice-send"
                            onPress={() => void voice.send()}
                            disabled={!connected}
                            color={colors.accent}
                        />
                    </>
                ) : (
                    <>
                        <IconButton
                            name="plus"
                            label="Прикрепить файл"
                            testID="chat-attach"
                            onPress={() => void composer.attach()}
                            disabled={
                                !enabled ||
                                composer.busy ||
                                !!edit ||
                                !!voice.pending ||
                                !!composer.attachment.file
                            }
                            color={colors.muted}
                        />
                        <View style={styles.inputContainer}>
                            <TextInput
                                ref={composer.input}
                                testID="message-input"
                                accessibilityLabel={edit ? 'Редактировать сообщение' : 'Сообщение'}
                                placeholder="Сообщение"
                                placeholderTextColor={colors.subtle}
                                value={composer.text}
                                onChangeText={composer.setText}
                                style={[styles.input, compact && styles.compactInput]}
                                multiline
                                disableFullscreenUI
                                maxLength={2000}
                                editable={
                                    enabled &&
                                    (!edit || !composer.busy) &&
                                    !voice.pending &&
                                    !composer.attachment.file
                                }
                                selectionColor={colors.accent}
                            />
                            <IconButton
                                name="smile"
                                label="Эмодзи"
                                onPress={() => {
                                    Keyboard.dismiss();
                                    composer.setEmojiOpen(!composer.emojiOpen);
                                }}
                                color={colors.muted}
                            />
                        </View>
                        {composer.text.trim() ? (
                            <IconButton
                                name={edit ? 'check' : 'send'}
                                label={edit ? 'Сохранить сообщение' : 'Отправить сообщение'}
                                testID="message-send"
                                onPress={() => void composer.send()}
                                disabled={!enabled || !connected || composer.busy}
                                color={colors.accent}
                            />
                        ) : (
                            <IconButton
                                name="mic"
                                label="Записать голосовое сообщение"
                                testID="voice-record"
                                onPress={() => void voice.start()}
                                disabled={
                                    !enabled ||
                                    composer.busy ||
                                    !!voice.pending ||
                                    !!composer.attachment.file
                                }
                                color={colors.accent}
                            />
                        )}
                    </>
                )}
            </View>
            {composer.text.length > 1800 && (
                <Text style={[ui.caption, { textAlign: 'right', paddingHorizontal: 16 }]}>
                    {composer.text.length} / 2000
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    compactComposer: { paddingVertical: 3, minHeight: 54 },
    compactInput: { maxHeight: 56, paddingVertical: 6 },
    reference: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingLeft: 20,
        backgroundColor: colors.surface,
    },
    referenceTitle: { fontSize: 12, color: colors.accent, fontWeight: '600' },
    composer: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        padding: 6,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        backgroundColor: colors.bg,
        minHeight: 62,
    },
    inputContainer: {
        flex: 1,
        backgroundColor: colors.surface,
        borderRadius: 20,
        flexDirection: 'row',
        alignItems: 'flex-end',
    },
    input: {
        flex: 1,
        fontSize: 16,
        color: colors.text,
        maxHeight: 128,
        minHeight: 46,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    recordDot: {
        width: 9,
        height: 9,
        borderRadius: 5,
        backgroundColor: colors.danger,
        marginHorizontal: 14,
        alignSelf: 'center',
    },
});
