import type { FeatureContext } from "../../../shared/socket/featureContext"
import { parseRoomIdField } from "../../../shared/socket/parseRoomId"
import type { RoomErrorAck, RoomSuccessAck } from "../../../shared/types/contracts/partyRoom"
import { socketAck } from "../../../shared/types/socket/ack"
import { revokeRoomAccess } from "../revokeRoomAccess"
import type { RoomIdPayload, RoomRemoveMemberPayload } from "./contracts"
import { changeRoom, lockRoomOwner, type RoomDatabase } from "./transaction"
import { listRoomMemberIds } from "./views"

async function removeMemberWrap(db: RoomDatabase, roomId: number, userId: number): Promise<void> {
    await db.query("DELETE FROM room_e2ee_wraps WHERE room_id = $1 AND user_id = $2", [roomId, userId])
}

export function publishRoomMemberChange(io: FeatureContext["io"], roomId: number, members: number[]): void {
    for (const member of members) io.to(String(member)).emit("room:membersChanged", { roomId })
}

export function registerRoomMembership({ io, socket, user }: FeatureContext): void {
    async function closeMemberAccess(roomId: number, memberId: number): Promise<void> {
        await revokeRoomAccess(io, roomId, memberId)
        publishRoomMemberChange(io, roomId, await listRoomMemberIds(roomId))
    }

    socket.on("room:removeMember", async (data: RoomRemoveMemberPayload, callback: unknown) => {
        const ack = socketAck<RoomSuccessAck | RoomErrorAck>(callback)
        try {
            const roomId = parseRoomIdField(data?.roomId)
            const memberId = parseRoomIdField(data?.userId)
            if (!roomId || !memberId) return ack?.({ err: "Invalid data" })
            if (memberId === user.id) return ack?.({ err: "Используйте Покинуть комнату для выхода" })

            const result = await changeRoom<RoomSuccessAck>(async (client) => {
                const owner = await lockRoomOwner(client, roomId)
                if (owner === null) return { err: "Комната не найдена" }
                if (owner !== user.id) return { err: "Удалять участников может только создатель" }
                const removed = await client.query(
                    "DELETE FROM room_members WHERE room_id = $1 AND user_id = $2 RETURNING 1",
                    [roomId, memberId]
                )
                if (removed.rowCount === 0) return { err: "Участник не найден" }
                await removeMemberWrap(client, roomId, memberId)
                return { success: true }
            })
            if ("err" in result) return ack?.(result)
            await closeMemberAccess(roomId, memberId)
            ack?.(result)
        } catch (error) {
            console.error("room:removeMember", error)
            ack?.({ err: "Ошибка" })
        }
    })

    socket.on("room:leaveRoom", async (data: RoomIdPayload, callback: unknown) => {
        const ack = socketAck<RoomSuccessAck | RoomErrorAck>(callback)
        try {
            const roomId = parseRoomIdField(data?.roomId)
            if (!roomId) return ack?.({ err: "Invalid room" })

            const result = await changeRoom<RoomSuccessAck>(async (client) => {
                if ((await lockRoomOwner(client, roomId)) === user.id)
                    return { err: "Сначала передайте владение другому участнику или удалите комнату" }
                const removed = await client.query("DELETE FROM room_members WHERE room_id = $1 AND user_id = $2", [
                    roomId,
                    user.id
                ])
                if (!removed.rowCount) return { err: "Участник не найден" }
                await removeMemberWrap(client, roomId, user.id)
                return { success: true }
            })
            if ("err" in result) return ack?.(result)
            await closeMemberAccess(roomId, user.id)
            socket.leave(`room:${roomId}`)
            ack?.(result)
        } catch (error) {
            console.error("room:leaveRoom", error)
            ack?.({ err: "Server error" })
        }
    })
}
