import type { DisplayMessage } from "./types"
import { compareDisplayMessages } from "./compareDisplayMessages"

export function mergeDisplayMessage(previous: DisplayMessage[], incoming: DisplayMessage): DisplayMessage[] {
    const saved = previous.find((message) => message.id === incoming.id)
    const message = {
        ...incoming,
        data: saved?.clientMessageId ? saved.data : incoming.data,
        read: !!incoming.read || !!saved?.read,
        clientMessageId: incoming.clientMessageId ?? saved?.clientMessageId
    }
    return [...previous.filter((item) => item.id !== message.id), message].sort(compareDisplayMessages)
}
