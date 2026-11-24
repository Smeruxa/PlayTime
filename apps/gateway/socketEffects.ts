import type { Server, Socket } from "socket.io"
import type { RelayHandlers } from "../shared/runtime/socketProtocol"
import { resolveAuthedUser } from "../shared/socket/featureContext"
import { invalidatePresenceFriends } from "./presence"
import { socketSnapshot } from "./socketState"

export function createSocketEffects(io: Server, onRoomsChanged: (socket: Socket) => void) {
    async function updateMembership(socket: Socket, operation: "join" | "leave", room: string): Promise<void> {
        if (operation === "join") await socket.join(room)
        else if (operation === "leave") await socket.leave(room)
        else throw new Error("Invalid membership command")
        socket.data.roomRevision = (socket.data.roomRevision ?? 0) + 1
        onRoomsChanged(socket)
    }

    function closeVoiceRooms(): void {
        for (const [room, ids] of io.sockets.adapter.rooms) {
            const match = /^room:(\d+)$/.exec(room)
            if (!match) continue
            io.to(room).emit("party:roomClosed", { roomId: Number(match[1]) })
            for (const id of ids) {
                const socket = io.sockets.sockets.get(id)
                if (socket) void updateMembership(socket, "leave", room).catch(() => socket.disconnect(true))
            }
        }
    }

    const handlers = {
        "io:emit"(rooms, except, event, args) {
            const target = io.to(rooms)
            if (except) target.except(except).emit(event, ...args)
            else target.emit(event, ...args)
        },
        async "io:fetch"(rooms) {
            const sockets = await io.in(rooms).fetchSockets()
            return sockets.flatMap(({ id }) => {
                const socket = io.sockets.sockets.get(id)
                return socket && resolveAuthedUser(socket) ? [socketSnapshot(socket)] : []
            })
        },
        async "io:membership"(id, operation, room) {
            const socket = io.sockets.sockets.get(id)
            if (!socket?.connected) return null
            await updateMembership(socket, operation, room)
            return socketSnapshot(socket)
        },
        async "io:leaveAll"(target, room) {
            const sockets = await io.in(target).fetchSockets()
            await Promise.all(
                sockets.map(async ({ id }) => {
                    const socket = io.sockets.sockets.get(id)
                    if (socket) await updateMembership(socket, "leave", room)
                })
            )
        },
        "io:disconnect"(rooms, close) {
            const targets = Array.isArray(rooms) ? rooms : [rooms]
            const ids = new Set(targets.flatMap((room) => Array.from(io.sockets.adapter.rooms.get(room) ?? [])))
            setImmediate(() => {
                for (const id of ids) {
                    const socket = io.sockets.sockets.get(id)
                    if (socket && targets.some((room) => socket.rooms.has(room))) socket.disconnect(close)
                }
            })
        },
        "io:serverSide"(event, args) {
            if (event === "playtime:presenceFriendsChanged" && Array.isArray(args[0])) {
                invalidatePresenceFriends(
                    ...args[0].filter((id: unknown): id is number => typeof id === "number" && Number.isSafeInteger(id))
                )
            }
        }
    } satisfies RelayHandlers

    return { handlers, closeVoiceRooms }
}
