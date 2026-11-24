import type { Socket } from "socket.io-client"
import { MessageSendError, sendWithReceipt } from "./sendWithReceipt"
import type { DisplayMessage } from "./types"
import { compareDisplayMessages } from "./compareDisplayMessages"

type OutgoingMedia = {
    replyToId?: number
    voiceKey?: string
    voiceDurationSec?: number
    attachmentKey?: string
    attachmentMime?: string
    attachmentFilename?: string
    attachmentSize?: number
}

export type OutgoingPayload = OutgoingMedia &
    (
        | { username: string; peerUserId?: number; message: string; roomId?: never; content?: never }
        | { roomId: number; content: string; username?: never; message?: never }
    )

export type OutgoingMessage = {
    clientId: string
    chatKey: string
    localId: number
    serverId?: number
    status: "sending" | "sent" | "failed"
    error?: string
    retryOnConnect: boolean
    display: Omit<DisplayMessage, "id" | "me">
    prepare: (signal: AbortSignal) => Promise<OutgoingPayload>
    payload?: OutgoingPayload
}

const outboxes = new WeakMap<Socket, Map<number, MessageOutbox>>()

export class MessageOutbox {
    private messages = new Map<string, OutgoingMessage>()
    private snapshot: readonly OutgoingMessage[] = []
    private listeners = new Set<() => void>()
    private inFlight = new Set<string>()
    private activeChats = new Map<string, string>()
    private nextLocalId = -1
    private lastQueuedAt = 0
    private controller = new AbortController()
    private readIds = new Map<string, Set<number>>()
    private deletedIds = new Set<number>()
    private connectionEpoch = 0

    constructor(
        private socket: Socket,
        private onDispose: () => void = () => {}
    ) {
        socket.on("connect", this.onConnect)
        socket.on("disconnect", this.onDisconnect)
        socket.on("message:deleted", this.onDeleted)
        socket.on("message:read", this.onRead)
    }

    subscribe = (listener: () => void) => {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    getSnapshot = () => this.snapshot

    createdAt(clientId: string): number | undefined {
        return this.messages.get(clientId)?.display.data
    }

    enqueue(chatKey: string, display: OutgoingMessage["display"], prepare: OutgoingMessage["prepare"]): string {
        const clientId = crypto.randomUUID()
        this.lastQueuedAt = Math.max(display.data, this.lastQueuedAt + 1)
        this.messages.set(clientId, {
            clientId,
            chatKey,
            localId: this.nextLocalId--,
            status: "sending",
            retryOnConnect: false,
            display: { ...display, data: this.lastQueuedAt },
            prepare
        })
        this.publish()
        this.processNext(chatKey)
        return clientId
    }

    retry = (clientId: string) => {
        const message = this.messages.get(clientId)
        if (message?.status !== "failed") return
        this.update(clientId, { status: "sending", error: undefined })
        this.processNext(message.chatKey)
    }

    confirm(chatKey: string, ciphertext: string, serverId: number): string | undefined {
        if (!Number.isSafeInteger(serverId) || serverId <= 0) return
        for (const message of Array.from(this.messages.values())) {
            const wire = message.payload?.message ?? message.payload?.content
            if (message.chatKey === chatKey && wire === ciphertext) {
                if (this.deletedIds.has(serverId)) {
                    this.messages.delete(message.clientId)
                    this.publish()
                    this.releaseChat(message)
                    return
                }
                this.update(message.clientId, { serverId, status: "sent", error: undefined, retryOnConnect: false })
                this.releaseChat(message)
                return message.clientId
            }
        }
    }

    forgetDeleted(serverId: number): void {
        if (!Number.isSafeInteger(serverId) || serverId <= 0 || this.deletedIds.has(serverId)) return
        this.deletedIds.add(serverId)
        while (this.deletedIds.size > 2000) this.deletedIds.delete(this.deletedIds.values().next().value!)
        for (const message of Array.from(this.messages.values())) {
            if (message.serverId === serverId) {
                this.messages.delete(message.clientId)
                this.releaseChat(message)
            }
        }
        this.publish()
    }

    retireStored(ids: ReadonlySet<number>): void {
        let changed = false
        for (const message of Array.from(this.messages.values())) {
            if (message.serverId && ids.has(message.serverId)) {
                this.messages.delete(message.clientId)
                changed = true
            }
        }
        if (changed) this.publish()
    }

    markRead(chatKey: string, ids: number[]): void {
        const known = this.readIds.get(chatKey) ?? new Set<number>()
        ids.forEach((id) => known.add(id))
        while (known.size > 2000) known.delete(known.values().next().value!)
        this.readIds.set(chatKey, known)
        for (const message of Array.from(this.messages.values())) {
            if (
                message.chatKey === chatKey &&
                message.serverId &&
                known.has(message.serverId) &&
                !message.display.read
            ) {
                this.update(message.clientId, { display: { ...message.display, read: true } })
            }
        }
    }

    isRead(chatKey: string, serverId: number): boolean {
        return this.readIds.get(chatKey)?.has(serverId) ?? false
    }

    private onDeleted = (event: { id?: number }) => {
        if (typeof event?.id === "number") this.forgetDeleted(event.id)
    }

    private onRead = (event: { readerUsername?: string; messageIds?: number[] }) => {
        if (!event?.readerUsername || !Array.isArray(event.messageIds)) return
        const chats = new Set(
            Array.from(this.messages.values())
                .filter((message) => message.payload?.username === event.readerUsername)
                .map((message) => message.chatKey)
        )
        chats.forEach((chatKey) => this.markRead(chatKey, event.messageIds!))
    }

    private onConnect = () => {
        this.connectionEpoch++
        for (const message of Array.from(this.messages.values())) {
            if (message.status === "failed" && message.retryOnConnect) {
                this.update(message.clientId, { status: "sending", error: undefined })
                this.processNext(message.chatKey)
            }
        }
    }

    private onDisconnect = (reason: string) => {
        if (reason !== "io client disconnect") return
        this.dispose()
    }

    dispose(): void {
        if (this.controller.signal.aborted) return
        this.controller.abort()
        this.messages.clear()
        this.activeChats.clear()
        this.readIds.clear()
        this.deletedIds.clear()
        this.socket.off("connect", this.onConnect)
        this.socket.off("disconnect", this.onDisconnect)
        this.socket.off("message:deleted", this.onDeleted)
        this.socket.off("message:read", this.onRead)
        this.publish()
        this.onDispose()
    }

    private async deliver(clientId: string): Promise<void> {
        const current = this.messages.get(clientId)
        if (!current || this.inFlight.has(clientId) || this.controller.signal.aborted) return
        this.inFlight.add(clientId)
        this.activeChats.set(current.chatKey, clientId)
        const connectionEpoch = this.connectionEpoch
        this.update(clientId, { status: "sending", error: undefined, retryOnConnect: false })
        try {
            if (!this.socket.connected) {
                throw new MessageSendError("Нет соединения. Отправка продолжится после подключения.", true)
            }
            const payload = current.payload ?? (await current.prepare(this.controller.signal))
            if (this.controller.signal.aborted) return
            this.update(clientId, { payload })
            const receipt = await sendWithReceipt(
                this.socket,
                { ...payload, clientMessageId: clientId },
                () => {},
                this.controller.signal
            )
            if (this.deletedIds.has(receipt.id)) {
                this.messages.delete(clientId)
                this.publish()
                return
            }
            this.update(clientId, {
                serverId: receipt.id,
                status: "sent",
                error: undefined,
                retryOnConnect: false,
                display: { ...current.display, read: this.readIds.get(current.chatKey)?.has(receipt.id) ?? false }
            })
        } catch (error) {
            if (this.controller.signal.aborted || this.messages.get(clientId)?.serverId) return
            const retryable = !this.socket.connected || (error instanceof MessageSendError && error.retryable)
            const reconnected = this.socket.connected && connectionEpoch !== this.connectionEpoch
            this.update(clientId, {
                status: retryable && reconnected ? "sending" : "failed",
                error: error instanceof Error ? error.message : "Не удалось отправить сообщение",
                retryOnConnect: retryable
            })
        } finally {
            this.inFlight.delete(clientId)
            this.releaseChat(current)
        }
    }

    private processNext(chatKey: string): void {
        if (this.activeChats.has(chatKey) || this.controller.signal.aborted) return
        const next = Array.from(this.messages.values()).find(
            (message) =>
                message.chatKey === chatKey && message.status === "sending" && !this.inFlight.has(message.clientId)
        )
        if (next) void this.deliver(next.clientId)
    }

    private releaseChat(message: OutgoingMessage): void {
        if (this.activeChats.get(message.chatKey) !== message.clientId) return
        this.activeChats.delete(message.chatKey)
        this.processNext(message.chatKey)
    }

    private update(clientId: string, update: Partial<OutgoingMessage>): void {
        const previous = this.messages.get(clientId)
        if (!previous || this.controller.signal.aborted) return
        this.messages.set(clientId, { ...previous, ...update })
        this.publish()
    }

    private publish(): void {
        this.snapshot = Array.from(this.messages.values())
        this.listeners.forEach((listener) => listener())
    }
}

export function getMessageOutbox(socket: Socket, userId: number): MessageOutbox {
    let accountOutboxes = outboxes.get(socket)
    if (!accountOutboxes) {
        accountOutboxes = new Map()
        outboxes.set(socket, accountOutboxes)
    }
    for (const [accountId, previous] of Array.from(accountOutboxes.entries())) {
        if (accountId !== userId) previous.dispose()
    }
    let outbox = accountOutboxes.get(userId)
    if (!outbox) {
        const accounts = accountOutboxes
        outbox = new MessageOutbox(socket, () => accounts.delete(userId))
        accountOutboxes.set(userId, outbox)
    }
    return outbox
}

export function disposeMessageOutbox(socket: Socket): void {
    for (const outbox of Array.from(outboxes.get(socket)?.values() ?? [])) outbox.dispose()
    outboxes.delete(socket)
}

export function mergeOutgoingMessages(
    stored: DisplayMessage[],
    outgoing: readonly OutgoingMessage[],
    chatKey: string
): DisplayMessage[] {
    const messages = new Map(stored.map((message) => [message.id, message]))
    for (const message of outgoing) {
        if (message.chatKey !== chatKey) continue
        const id = message.serverId ?? message.localId
        const saved = messages.get(id)
        messages.set(
            id,
            saved
                ? { ...saved, data: message.display.data, clientMessageId: message.clientId }
                : {
                      ...message.display,
                      id,
                      me: true,
                      clientMessageId: message.clientId,
                      delivery: { status: message.status, error: message.error }
                  }
        )
    }
    return Array.from(messages.values()).sort(compareDisplayMessages)
}
