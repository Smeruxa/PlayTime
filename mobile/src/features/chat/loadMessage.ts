import type { Message } from '../../types';

type HistorySource = {
    readonly snapshot: {
        messages: readonly Message[];
        hasMore: boolean;
        historyLoading: boolean;
    };
    loadOlder: () => Promise<void>;
};

export async function loadMessage(
    id: number,
    source: HistorySource,
    active: () => boolean,
): Promise<boolean> {
    while (active()) {
        const { messages, hasMore, historyLoading } = source.snapshot;
        if (messages.some((message) => message.id === id)) {
            return true;
        }
        const oldest = messages[0]?.id;
        if (!hasMore || oldest == null || oldest <= id) {
            throw new Error('Сообщение удалено или больше недоступно в этой переписке.');
        }
        if (historyLoading) {
            throw new Error('История ещё загружается. Повторите переход через несколько секунд.');
        }
        await source.loadOlder();
        if (active() && source.snapshot.messages[0]?.id === oldest) {
            throw new Error('Не удалось загрузить предыдущие сообщения. Попробуйте ещё раз.');
        }
    }
    return false;
}
