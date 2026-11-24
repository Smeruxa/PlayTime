import type { Message } from '../../types';

export function sameMessageDay(first: number, second: number): boolean {
    const a = new Date(first);
    const b = new Date(second);
    return (
        Number.isFinite(first) && Number.isFinite(second) && a.toDateString() === b.toDateString()
    );
}

export function messagesGrouped(
    current: Message,
    previous: Message | undefined,
    room: boolean,
): boolean {
    if (!previous || current.isThreadOp || previous.isThreadOp || current.me !== previous.me) {
        return false;
    }
    if (
        !sameMessageDay(current.data, previous.data) ||
        Math.abs(current.data - previous.data) > 5 * 60 * 1000
    ) {
        return false;
    }
    return !room || current.me || (!!current.from.trim() && current.from === previous.from);
}

export function startsUnreadMessages(
    current: Message,
    previous: Message | undefined,
    readWatermark: number,
): boolean {
    return (
        readWatermark > 0 &&
        current.id > readWatermark &&
        !!previous &&
        previous.id <= readWatermark &&
        !current.isThreadOp &&
        !previous.isThreadOp
    );
}

export function searchMessages(messages: readonly Message[], query: string): number[] {
    const value = query.trim().toLocaleLowerCase();
    if (!value) {
        return [];
    }
    return messages
        .filter(
            (message) =>
                !message.decryptError &&
                (message.text.toLocaleLowerCase().includes(value) ||
                    (message.media?.filename || message.attachment?.filename || '')
                        .toLocaleLowerCase()
                        .includes(value)),
        )
        .map((message) => message.id);
}
