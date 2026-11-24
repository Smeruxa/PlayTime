import type { Message } from '../types';

export function replyPreview(message: Message, history: readonly Message[]): string {
    if (!message.reply) {
        return '';
    }
    const original = history.find((item) => item.id === message.reply!.id);
    if (!original || original.decryptError) {
        return message.reply.preview || 'Сообщение недоступно';
    }
    if (original.voice) {
        return 'Голосовое сообщение';
    }
    if (original.attachment) {
        return `Файл: ${original.attachment.filename}`;
    }
    return original.text.replace(/\s+/g, ' ').trim();
}
