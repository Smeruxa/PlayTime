import type { FeatureContext, FeatureIo, FeatureListener } from "../socket/featureContext"
import type { ServiceRelay } from "./relay"
import { createFeatureSocket, type RelayConnections } from "./socketAdapter"
import type { RelayHandlers, SocketCommand, SocketSnapshot } from "./socketProtocol"

export type SocketLifecycle = {
    register(ctx: FeatureContext): void
    connect?(ctx: FeatureContext, renewal?: boolean): Promise<unknown>
    disconnect?(ctx: FeatureContext): Promise<unknown>
}

type HostedSocket = {
    ctx: FeatureContext
    sessionRevision: number
    roomRevision: number
    handlers: Map<string, FeatureListener[]>
    ended: boolean
    leaving: boolean
}

function applySnapshot(hosted: HostedSocket, snapshot: SocketSnapshot): void {
    if (snapshot.sessionRevision >= hosted.sessionRevision) {
        hosted.ctx.socket.data.accessSession = snapshot.session
        hosted.sessionRevision = snapshot.sessionRevision
    }
    if (snapshot.roomRevision >= hosted.roomRevision) {
        hosted.roomRevision = snapshot.roomRevision
        hosted.ctx.socket.rooms.clear()
        for (const room of snapshot.rooms) hosted.ctx.socket.rooms.add(room)
    }
}

async function run(socket: HostedSocket, event: string, args: unknown[] = []): Promise<void> {
    await Promise.all((socket.handlers.get(event) ?? []).map((handler) => handler(...args)))
}

async function leave(socket: HostedSocket): Promise<void> {
    if (socket.leaving) return
    socket.leaving = true
    await run(socket, "disconnecting")
}

export function hostSockets(
    io: FeatureIo,
    lifecycle: SocketLifecycle,
    connections: RelayConnections,
    attachedRelay: () => ServiceRelay,
    waitForCleanup: () => Promise<unknown> | undefined
) {
    const hosted = new Map<string, HostedSocket>()

    async function disconnect(socket: HostedSocket): Promise<void> {
        if (socket.ended) return
        socket.ended = true
        hosted.delete(socket.ctx.socket.id)
        try {
            await leave(socket)
            await run(socket, "disconnect")
        } finally {
            await lifecycle.disconnect?.(socket.ctx)
        }
    }

    function bind(snapshot: SocketSnapshot): { state: HostedSocket; created: boolean } {
        const existing = hosted.get(snapshot.id)
        if (existing) {
            applySnapshot(existing, snapshot)
            return { state: existing, created: false }
        }

        const handlers = new Map<string, FeatureListener[]>()
        const socket = createFeatureSocket(io, connections, attachedRelay, snapshot, handlers, (updated) => {
            applySnapshot(state, updated)
        })
        const ctx: FeatureContext = { io, socket, user: snapshot.user }
        const state: HostedSocket = {
            ctx,
            sessionRevision: snapshot.sessionRevision,
            roomRevision: snapshot.roomRevision,
            handlers,
            ended: false,
            leaving: false
        }
        hosted.set(snapshot.id, state)
        try {
            lifecycle.register(ctx)
        } catch (error) {
            hosted.delete(snapshot.id)
            throw error
        }
        return { state, created: true }
    }

    async function connect(snapshot: SocketSnapshot, renewal = false): Promise<void> {
        await waitForCleanup()
        if (!attachedRelay().connected) throw new Error("Gateway connection unavailable")
        const { state, created } = bind(snapshot)
        if (!created && !renewal) return
        try {
            await lifecycle.connect?.(state.ctx, renewal)
        } catch (error) {
            hosted.delete(snapshot.id)
            throw error
        }
    }

    async function dispatch(snapshot: SocketSnapshot, command: SocketCommand): Promise<unknown[] | undefined> {
        const socket = hosted.get(snapshot.id)
        if (!socket || socket.leaving || socket.ended) throw new Error("Socket is unavailable")
        if (command.event === "disconnect" || command.event === "disconnecting") return
        applySnapshot(socket, snapshot)
        const args = [...command.args]
        if (!command.expectsAck) {
            await run(socket, command.event, args)
            return
        }
        let reply: unknown[] | undefined
        args.push((...ack: unknown[]) => {
            reply ??= ack
        })
        await run(socket, command.event, args)
        return reply
    }

    const handlers: RelayHandlers = {
        "socket:connect": (snapshot) => connect(snapshot),
        "socket:attach": (snapshot) => connect(snapshot, true),
        "socket:refresh": async (snapshot) => {
            const socket = hosted.get(snapshot.id)
            if (!socket) throw new Error("Socket is unavailable")
            applySnapshot(socket, snapshot)
            await lifecycle.connect?.(socket.ctx, true)
        },
        "socket:rooms": (snapshot) => {
            const socket = hosted.get(snapshot.id)
            if (socket) applySnapshot(socket, snapshot)
        },
        "socket:dispatch": dispatch,
        "socket:leaving": async (snapshot) => {
            const socket = hosted.get(snapshot.id)
            if (!socket) return
            applySnapshot(socket, snapshot)
            await leave(socket)
        },
        "socket:disconnect": async (id) => {
            const socket = hosted.get(id)
            if (socket) await disconnect(socket)
        },
        "socket:detach": async (snapshot) => {
            await disconnect(bind(snapshot).state)
        }
    }
    return {
        handlers,
        close: () => Promise.allSettled([...hosted.values()].map(disconnect)),
        discard: () => hosted.clear()
    }
}
