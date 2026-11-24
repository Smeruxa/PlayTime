import type { Server, Socket } from "socket.io"
import { accessSessionRoom, deviceSessionRoom, type AccessTokenPayload } from "../shared/types/contracts/accessSession"
import { boundedFeatureSocket } from "./socketBudget"
import { resolveAuthedUser } from "../shared/socket/featureContext"
import registerPresenceHandlers, { onConnect, onDisconnect } from "./presence"
import { peerIdentityUserRoom } from "../shared/socket/peerAudience"
import type { GatewaySlot, RelayHandlers } from "../shared/runtime/socketProtocol"
import type { PlanSlug } from "../shared/subscription/planCatalog"
import { socketAck } from "../shared/types/socket/ack"
import type { GetUsernameAckPayload } from "../shared/types/socket/usernamePayload"
import { DomainConnection, type ClientAck } from "./domainConnection"
import { serviceEvents } from "./events"
import { createSocketEffects } from "./socketEffects"
import { socketHandshake } from "./socketState"
import { startAuthRevocationListener } from "./authRevocationListener"

export function createGatewaySockets(
    io: Server,
    slot: GatewaySlot | undefined,
    checkSession: (session: AccessTokenPayload) => Promise<void>
) {
    const pending = new Set<Promise<void>>()
    const { handlers, closeVoiceRooms } = createSocketEffects(io, (socket) => {
        for (const { connection } of routes) connection.syncRooms(socket)
    })
    const closeTransports = () => {
        for (const socket of io.sockets.sockets.values()) socket.conn.close()
    }
    const revocations = process.env.PLAYTIME_AUTH_HA === "1" ? startAuthRevocationListener(io, checkSession) : undefined
    const authHandlers: RelayHandlers = revocations
        ? {
              ...handlers,
              "io:emit": (rooms, except, event, args) => {
                  if (event !== "session:revoked") handlers["io:emit"](rooms, except, event, args)
              },
              "io:disconnect": (rooms) => revocations.recheck(rooms)
          }
        : handlers
    const auth = new DomainConnection(
        "AUTH",
        io,
        authHandlers,
        () => {
            if (!revocations) closeTransports()
        },
        slot
    )
    const chat = new DomainConnection(
        "CHAT",
        io,
        handlers,
        () => {
            closeVoiceRooms()
            if (slot) closeTransports()
        },
        slot
    )
    const room = new DomainConnection("ROOM", io, handlers, closeVoiceRooms, slot)
    const authAvailable = () => revocations?.ready() ?? auth.connected
    const chatAvailable = () => chat.multiGateway
    const routes = [
        { connection: auth, events: serviceEvents.AUTH },
        { connection: chat, events: serviceEvents.CHAT },
        { connection: room, events: serviceEvents.ROOM }
    ]
    for (const { connection } of routes) connection.start()

    io.on("connection", (socket) => {
        const user = resolveAuthedUser(socket)
        if (!user || !authAvailable() || (slot && !chatAvailable())) return socket.conn.close()

        const { jti, sessionId } = socket.data.accessSession
        socket.join(String(user.id))
        if (socketHandshake(socket).peerIdentityProtocol === 1) socket.join(peerIdentityUserRoom(user.id))
        socket.join(accessSessionRoom(jti))
        if (sessionId) socket.join(deviceSessionRoom(sessionId))

        const localPresence = !chat.multiGateway
        onConnect(socket, localPresence && io)
        const bounded = boundedFeatureSocket(socket, user.id)
        registerPresenceHandlers({ io, socket: bounded, user }, (event, callback) => {
            if (!chat.multiGateway || typeof callback !== "function") return false
            void chat.dispatch(socket, event, [], callback as ClientAck).catch(() => (callback as ClientAck)([]))
            return true
        })
        socket.on("get:username", (callback: unknown) => {
            socketAck<GetUsernameAckPayload>(callback)?.({ username: user.username, userId: user.id })
        })

        for (const { connection, events } of routes) {
            void connection.connect(socket).catch(() => undefined)
            for (const event of events) {
                bounded.on(event, (...args: unknown[]) => {
                    const last = args[args.length - 1]
                    const acknowledge = typeof last === "function" ? (last as ClientAck) : undefined
                    if (acknowledge) args.pop()
                    const command = connection.dispatch(socket, event, args, acknowledge).catch(() => {
                        acknowledge?.({ err: "Сервис временно недоступен" })
                    })
                    pending.add(command)
                    return command.finally(() => pending.delete(command)).then(() => undefined)
                })
            }
        }

        socket.on("disconnecting", () => {
            for (const { connection } of routes) connection.leaving(socket)
        })
        socket.on("disconnect", () => {
            for (const { connection } of routes) connection.disconnect(socket)
            onDisconnect(socket, localPresence && !chat.multiGateway && io)
        })
    })

    return {
        authAvailable,
        chatAvailable,
        domainReplicaCount: () => [chat.readyReplicas, room.readyReplicas] as const,
        allRelaysAvailable: () => (revocations?.ready() ?? auth.multiGateway) && chatAvailable() && room.multiGateway,
        verifySession: <T extends { session: AccessTokenPayload }>(verify: () => Promise<T>): Promise<T> =>
            revocations?.verify(verify) ?? verify(),
        publishPlan: (userId: number, planSlug: PlanSlug) => {
            if (!(revocations ? chat : auth).publishPlan(userId, planSlug))
                io.to(String(userId)).emit("subscription:planChanged", { planSlug })
        },
        refreshEndpoint: async (socket: Socket) => {
            socket.data.sessionRevision = (socket.data.sessionRevision ?? 0) + 1
            if (room.connected) void room.refreshSession(socket).catch(() => undefined)
        },
        waitForCommands: () => Promise.allSettled(pending),
        stop: async () => {
            revocations?.close()
            await Promise.all(routes.map(({ connection }) => connection.stop()))
        }
    }
}
