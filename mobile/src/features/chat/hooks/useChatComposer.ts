import { useCallback, useRef, useState, type ComponentRef } from 'react';
import { TextInput } from 'react-native';
import { useApp } from '../../../state/AppContext';
import { useAction } from '../../../state/useAction';
import type { LocalMedia, Message } from '../../../types';
import { useChatDraft } from './useChatDraft';
import { useMediaSender } from './useMediaSender';
import { useAttachmentComposer } from './useAttachmentComposer';
import { useVoiceMessageRecording } from './useVoiceMessageRecording';

export function useChatComposer() {
    const { client, state, calls } = useApp();
    const chat = state.currentChat;
    const draftKey = `draft:${state.session?.user.id}:${chat?.isRoom ? 'room' : 'dm'}:${chat?.id}`;
    const { draft, setDraft, clearDraft } = useChatDraft(draftKey);
    const [reply, setReply] = useState<Message | null>(null);
    const [edit, setEdit] = useState<Message | null>(null);
    const [editText, setEditText] = useState('');
    const [emojiOpen, setEmojiOpen] = useState(false);
    const input = useRef<ComponentRef<typeof TextInput>>(null);
    const action = useAction();
    const text = edit ? editText : draft;
    const setText = edit ? setEditText : setDraft;

    const sendMedia = useMediaSender(reply?.id);
    const sendVoice = useCallback(
        async (file: LocalMedia) => {
            await sendMedia(file, 'voice');
            setReply(null);
        },
        [sendMedia],
    );

    const voice = useVoiceMessageRecording({
        maxDuration: state.subscription?.limits.maxVoiceMessageSec || 45,
        inCall: !!calls?.snapshot.call,
        onSend: sendVoice,
    });

    const send = () =>
        action.run(async () => {
            if (!text.trim()) {
                return;
            }
            if (edit) {
                await client.editMessage(edit.id, text.trim());
                setEditText('');
                setEdit(null);
            } else {
                await client.sendMessage(text.trim(), { replyToId: reply?.id });
                await clearDraft(text);
                setReply(null);
            }
            client.typing(false);
        });

    const attachment = useAttachmentComposer({
        maxBytes: state.subscription?.limits.maxAttachmentBytes || 2 * 1024 * 1024,
        onSend: async (file) => {
            await sendMedia(file, 'attachment');
            setReply(null);
        },
    });

    return {
        text,
        reply,
        edit,
        input,
        emojiOpen,
        setEmojiOpen,
        voice,
        attachment,
        busy: action.busy || voice.busy || attachment.busy,
        error: action.error || voice.error || attachment.error,
        clearError: () => {
            action.setError('');
            voice.setError('');
            attachment.setError('');
        },
        setText: (value: string) => {
            setText(value);
            client.typing(!!value);
        },
        replyTo: (message: Message) => {
            setReply(message);
            input.current?.focus();
        },
        editMessage: (message: Message) => {
            setEditText(message.text);
            setEdit(message);
            input.current?.focus();
        },
        cancelReference: () => {
            setReply(null);
            setEdit(null);
            setEditText('');
        },
        send,
        attach: attachment.pick,
    };
}
