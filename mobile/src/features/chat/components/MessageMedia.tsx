import React from 'react';
import type { Message } from '../../../types';
import { useMediaDownload } from '../hooks/useMediaDownload';
import { AttachmentMessage } from './AttachmentMessage';
import { VoiceMessagePlayer } from './VoiceMessagePlayer';

export function MessageMedia({ message }: { message: Message }) {
    const media = message.media || message.voice?.media || message.attachment?.media;
    const load = useMediaDownload(media);
    if (media?.kind === 'voice' || message.voice) {
        return (
            <VoiceMessagePlayer
                owner={`message:${message.id}`}
                load={load}
                durationSec={media?.durationSec || message.voice?.durationSec || 0}
            />
        );
    }
    return (
        <AttachmentMessage
            media={media}
            filename={media?.filename || message.attachment?.filename || 'Вложение'}
            mime={media?.mime || message.attachment?.mime || 'application/octet-stream'}
            sizeBytes={media?.sizeBytes || message.attachment?.sizeBytes || 0}
        />
    );
}
