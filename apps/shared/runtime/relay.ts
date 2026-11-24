import { deserialize, serialize } from "node:v8"
import WebSocket from "ws"
import type {
    NotificationArgs,
    NotificationName,
    RelayHandlers,
    RequestArgs,
    RequestName,
    RequestResult
} from "./socketProtocol"

export const maxRelayPayload = 12 * 1024 * 1024
const relayQueueLimit = maxRelayPayload * 2
const replyReserve = 64 * 1024

type Packet =
    | { kind: "request"; id: number; method: string; args: unknown[] }
    | { kind: "notification"; method: string; args: unknown[] }
    | { kind: "response"; id: number; ok: boolean; value?: unknown }

type Pending = {
    resolve(value: unknown): void
    reject(error: Error): void
    timer: ReturnType<typeof setTimeout>
}

function decodePacket(data: Buffer): Packet | undefined {
    const packet: unknown = deserialize(data)
    if (!packet || typeof packet !== "object" || !("kind" in packet)) return
    if (packet.kind === "response") {
        if (!("id" in packet) || typeof packet.id !== "number" || !Number.isSafeInteger(packet.id)) return
        if (!("ok" in packet) || typeof packet.ok !== "boolean") return
        return { kind: "response", id: packet.id, ok: packet.ok, value: "value" in packet ? packet.value : undefined }
    }
    if (packet.kind !== "notification" && packet.kind !== "request") return
    if (
        !("method" in packet) ||
        typeof packet.method !== "string" ||
        !("args" in packet) ||
        !Array.isArray(packet.args)
    )
        return
    if (packet.kind === "notification") return { kind: "notification", method: packet.method, args: packet.args }
    if (!("id" in packet) || typeof packet.id !== "number" || !Number.isSafeInteger(packet.id)) return
    return { kind: "request", id: packet.id, method: packet.method, args: packet.args }
}

export class ServiceRelay {
    private readonly pending = new Map<number, Pending>()
    private readonly idle = new Set<() => void>()
    private requestId = 0
    private lastUnavailableNotice = 0

    constructor(
        private readonly socket: WebSocket,
        private readonly handlers: RelayHandlers
    ) {
        let awaitingPong = false
        const heartbeat = setInterval(() => {
            if (!this.connected) return
            if (awaitingPong) {
                socket.terminate()
                return
            }
            awaitingPong = true
            socket.ping()
        }, 5000).unref()
        socket.on("pong", () => {
            awaitingPong = false
        })
        socket.on("message", (data, isBinary) => {
            if (!isBinary || !Buffer.isBuffer(data)) return socket.close(1003)
            try {
                const packet = decodePacket(data)
                if (!packet) return socket.close(1003)
                if (packet.kind === "response") this.complete(packet)
                else this.dispatch(packet)
            } catch {
                socket.close(1003)
            }
        })
        socket.on("close", () => {
            clearInterval(heartbeat)
            for (const pending of this.pending.values()) {
                clearTimeout(pending.timer)
                pending.reject(new Error("Service link closed"))
            }
            this.pending.clear()
            this.checkIdle()
        })
        socket.on("error", () => socket.terminate())
    }

    get connected(): boolean {
        return this.socket.readyState === WebSocket.OPEN
    }

    private complete(packet: Extract<Packet, { kind: "response" }>) {
        const pending = this.pending.get(packet.id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(packet.id)
        if (packet.ok) pending.resolve(packet.value)
        else pending.reject(new Error("Service command failed"))
        this.checkIdle()
    }

    private dispatch(packet: Exclude<Packet, { kind: "response" }>) {
        const handler: unknown = Object.getOwnPropertyDescriptor(this.handlers, packet.method)?.value
        void Promise.resolve()
            .then(() => {
                if (typeof handler !== "function") throw new Error("Unknown relay method")
                return (handler as (...args: unknown[]) => unknown)(...packet.args)
            })
            .then((value) => {
                if (packet.kind !== "request") return
                const delivered = this.send({ kind: "response", id: packet.id, ok: true, value })
                if (!delivered) this.send({ kind: "response", id: packet.id, ok: false })
            })
            .catch(() => {
                if (packet.kind === "request") this.send({ kind: "response", id: packet.id, ok: false })
                else console.error("Service notification failed", packet.method)
            })
    }

    private send(packet: Packet): boolean {
        if (!this.connected) return false
        try {
            const encoded = serialize(packet)
            if (encoded.length > maxRelayPayload) return false
            const reserved = packet.kind === "response" && !packet.ok ? 0 : replyReserve
            if (this.socket.bufferedAmount + encoded.length > relayQueueLimit - reserved) return false
            this.socket.send(encoded, { binary: true }, (error) => {
                if (error) this.socket.terminate()
            })
            return true
        } catch {
            return false
        }
    }

    notify<Name extends NotificationName>(method: Name, ...args: NotificationArgs<Name>): void {
        if (!this.send({ kind: "notification", method, args }) && Date.now() - this.lastUnavailableNotice >= 10_000) {
            this.lastUnavailableNotice = Date.now()
            console.error("Service notification unavailable", method)
        }
    }

    request<Name extends RequestName>(method: Name, ...args: RequestArgs<Name>): Promise<RequestResult<Name>> {
        return this.requestCommand(method, args)
    }

    requestWithReply<Name extends RequestName>(
        method: Name,
        reply: (value: RequestResult<Name>) => void,
        ...args: RequestArgs<Name>
    ): Promise<RequestResult<Name>> {
        return this.requestCommand(method, args, reply)
    }

    waitForReplies(): Promise<void> {
        if (!this.pending.size) return Promise.resolve()
        return new Promise((resolve) => this.idle.add(resolve))
    }

    private checkIdle(): void {
        if (this.pending.size) return
        for (const resolve of this.idle) resolve()
        this.idle.clear()
    }

    private requestCommand<Name extends RequestName>(
        method: Name,
        args: RequestArgs<Name>,
        reply?: (value: RequestResult<Name>) => void
    ): Promise<RequestResult<Name>> {
        return new Promise((resolve, reject) => {
            if (this.pending.size >= 8192) return reject(new Error("Service link busy"))
            const id = ++this.requestId
            const timer = setTimeout(() => {
                this.pending.delete(id)
                reject(new Error("Service command timed out"))
                this.checkIdle()
            }, 12000)
            timer.unref()
            this.pending.set(id, {
                resolve: (value) => {
                    try {
                        const result = value as RequestResult<Name>
                        reply?.(result)
                        resolve(result)
                    } catch (error) {
                        reject(error)
                    }
                },
                reject,
                timer
            })
            if (!this.send({ kind: "request", id, method, args })) {
                clearTimeout(timer)
                this.pending.delete(id)
                reject(new Error("Service link unavailable"))
                this.checkIdle()
            }
        })
    }
}
