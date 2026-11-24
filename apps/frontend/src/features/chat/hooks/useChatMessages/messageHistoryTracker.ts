import type { DisplayMessage } from "../../types"
import { compareDisplayMessages } from "../../compareDisplayMessages"

export type MessageUpdate = (messages: DisplayMessage[]) => DisplayMessage[]

type PendingHistory = {
    older: boolean
    existingIds: ReadonlySet<number>
    confirmedOutgoingIds: ReadonlySet<number>
    updateIndex: number
}

export type AcceptedHistory = {
    older: boolean
    confirmedOutgoingIds: ReadonlySet<number>
    merge: (previous: DisplayMessage[], loaded: DisplayMessage[]) => DisplayMessage[]
}

export class MessageHistoryTracker {
    private requests = new Map<string, PendingHistory>()
    private updates: MessageUpdate[] = []

    beginLatest(requestId: string, existingIds: Iterable<number>, confirmedOutgoingIds: Iterable<number>): void {
        this.requests.clear()
        this.updates = []
        this.requests.set(requestId, {
            older: false,
            existingIds: new Set(existingIds),
            confirmedOutgoingIds: new Set(confirmedOutgoingIds),
            updateIndex: 0
        })
    }

    beginOlder(requestId: string): void {
        this.requests.set(requestId, {
            older: true,
            existingIds: new Set(),
            confirmedOutgoingIds: new Set(),
            updateIndex: this.updates.length
        })
    }

    isPending(requestId?: string): boolean {
        return !!requestId && this.requests.has(requestId)
    }

    hasLatest(): boolean {
        return Array.from(this.requests.values()).some((request) => !request.older)
    }

    record(update: MessageUpdate): void {
        if (this.requests.size > 0) this.updates.push(update)
    }

    accept(requestId?: string): AcceptedHistory | null {
        const request = requestId ? this.requests.get(requestId) : undefined
        if (!request || !requestId) return null
        this.requests.delete(requestId)
        const updates = this.updates.slice(request.updateIndex)
        if (this.requests.size === 0) this.updates = []
        return {
            older: request.older,
            confirmedOutgoingIds: request.confirmedOutgoingIds,
            merge(previous, loaded) {
                const previousById = new Map(previous.map((message) => [message.id, message]))
                const byId = new Map(
                    previous
                        .filter((message) => request.older || !request.existingIds.has(message.id))
                        .map((message) => [message.id, message])
                )
                for (const incoming of loaded) {
                    const saved = previousById.get(incoming.id)
                    byId.set(incoming.id, {
                        ...incoming,
                        data: saved?.clientMessageId ? saved.data : incoming.data,
                        read: !!incoming.read || !!saved?.read,
                        clientMessageId: incoming.clientMessageId ?? saved?.clientMessageId
                    })
                }
                let messages = Array.from(byId.values()).sort(compareDisplayMessages)
                for (const update of updates) messages = update(messages)
                return messages
            }
        }
    }

    cancel(requestId: string): void {
        this.requests.delete(requestId)
        if (this.requests.size === 0) this.updates = []
    }
}
