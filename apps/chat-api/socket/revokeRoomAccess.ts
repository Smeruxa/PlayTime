import type { FeatureIo } from "../../shared/socket/featureContext"

export async function revokeRoomAccess(io: Pick<FeatureIo, "in" | "to">, roomId: number, userId: number): Promise<void> {
    const roomName = `room:${roomId}`
    const sockets = await io.in(userId.toString()).fetchSockets()
    for (const socket of sockets) await socket.leave(roomName)
    io.to(roomName).emit("party:participant:left", { userId })
    io.to(userId.toString()).emit("room:removed", { roomId })
}
