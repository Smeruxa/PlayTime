import type {
    FeatureIo,
    FeatureListener,
    FeatureRemoteSocket,
    FeatureRooms,
    FeatureSocket,
    RoomTarget
} from "../socket/featureContext"
import type { ServiceRelay } from "./relay"
import type { SocketSnapshot } from "./socketProtocol"

export type RelayConnections = () => readonly ServiceRelay[]

function emitToRelays(
    connections: RelayConnections,
    rooms: RoomTarget,
    except: string | undefined,
    event: string,
    args: unknown[]
): boolean {
    for (const relay of connections()) relay.notify("io:emit", rooms, except, event, args)
    return true
}

function remoteSocket(relay: () => ServiceRelay, snapshot: SocketSnapshot): FeatureRemoteSocket {
    return {
        id: snapshot.id,
        user: snapshot.user,
        handshake: { auth: snapshot.auth },
        data: { accessSession: snapshot.session },
        emit: (event, ...args) => {
            relay().notify("io:emit", snapshot.id, undefined, event, args)
            return true
        },
        leave: async (room) => {
            await relay().request("io:membership", snapshot.id, "leave", room)
        }
    }
}

async function fetchGatewaySockets(relay: ServiceRelay, rooms: RoomTarget): Promise<FeatureRemoteSocket[]> {
    try {
        return (await relay.request("io:fetch", rooms)).map((snapshot) => remoteSocket(() => relay, snapshot))
    } catch (error) {
        if (!relay.connected) return []
        throw error
    }
}

function roomOperations(connections: RelayConnections, rooms: RoomTarget, except?: string): FeatureRooms {
    return {
        emit: (event, ...args) => emitToRelays(connections, rooms, except, event, args),
        async emitConfirmed(event, ...args) {
            const relays = connections()
            if (!relays.length) throw new Error("Gateway connection unavailable")
            const results = await Promise.allSettled(
                relays.map(async (relay) => {
                    try {
                        await relay.request("io:emit", rooms, except, event, args)
                    } catch (error) {
                        if (relay.connected) throw error
                    }
                })
            )
            const failed = results.find((result) => result.status === "rejected")
            if (failed) throw failed.reason
        },
        fetchSockets: async () => {
            const relays = connections()
            if (!relays.length) throw new Error("Gateway connection unavailable")
            return (await Promise.all(relays.map((relay) => fetchGatewaySockets(relay, rooms)))).flat()
        },
        disconnectSockets(close = false) {
            for (const relay of connections()) relay.notify("io:disconnect", rooms, close)
        },
        socketsLeave(room) {
            for (const relay of connections()) relay.notify("io:leaveAll", rooms, room)
        }
    }
}

export function createFeatureIo(connections: RelayConnections): FeatureIo {
    return {
        to: (rooms) => roomOperations(connections, rooms),
        in: (rooms) => roomOperations(connections, rooms),
        serverSideEmit(event, ...args) {
            for (const relay of connections()) relay.notify("io:serverSide", event, args)
            return true
        }
    }
}

export function createFeatureSocket(
    io: FeatureIo,
    connections: RelayConnections,
    attachedRelay: () => ServiceRelay,
    snapshot: SocketSnapshot,
    handlers: Map<string, FeatureListener[]>,
    update: (snapshot: SocketSnapshot) => void
): FeatureSocket {
    async function membership(operation: "join" | "leave", room: string): Promise<void> {
        const updated = await attachedRelay().request("io:membership", snapshot.id, operation, room)
        if (updated) update(updated)
    }

    function changeMembership(operation: "join" | "leave", room: string): Promise<void> {
        const result = membership(operation, room)
        void result.catch(() => console.error("Gateway socket operation failed"))
        return result
    }

    return {
        ...remoteSocket(attachedRelay, snapshot),
        rooms: new Set(snapshot.rooms),
        nsp: { server: io, in: io.in },
        on(event, handler) {
            const listeners = handlers.get(event) ?? []
            listeners.push(handler)
            handlers.set(event, listeners)
        },
        to: (rooms) => roomOperations(connections, rooms, snapshot.id),
        join: (room) => changeMembership("join", room),
        leave: (room) => changeMembership("leave", room)
    }
}
