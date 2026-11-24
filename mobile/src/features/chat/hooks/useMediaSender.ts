import { useCallback, useEffect, useRef } from 'react';
import { randomId } from '../../../services/crypto';
import { useApp } from '../../../state/AppContext';
import type { LocalMedia, MediaDescriptor } from '../../../types';

type Uploaded = { media: MediaDescriptor; clientMessageId: string };

export function useMediaSender(replyToId?: number) {
    const { client, state } = useApp();
    const chat = state.currentChat;
    const userId = state.session?.user.id;
    const mounted = useRef(true);
    const uploaded = useRef(new Map<string, Uploaded>());

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    return useCallback(
        async (file: LocalMedia, kind: 'voice' | 'attachment') => {
            const ensureTarget = () => {
                const current = client.snapshot;
                if (
                    !mounted.current ||
                    current.session?.user.id !== userId ||
                    current.currentChat?.id !== chat?.id ||
                    current.currentChat?.isRoom !== chat?.isRoom
                ) {
                    throw new Error('Разговор изменился. Отправка вложения остановлена.');
                }
            };
            ensureTarget();
            let attachment = uploaded.current.get(file.uri);
            if (!attachment) {
                const media = await client.uploadMedia(file, kind);
                attachment = { media, clientMessageId: randomId() };
                uploaded.current.set(file.uri, attachment);
            }
            ensureTarget();
            await client.sendMessage('', { ...attachment, replyToId });
            uploaded.current.delete(file.uri);
        },
        [chat?.id, chat?.isRoom, client, replyToId, userId],
    );
}
