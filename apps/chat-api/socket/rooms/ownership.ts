import { getLimitsForUser } from "../../../database/subscriptionPlans"
import { pool } from "../../../shared/deps"
import type { FeatureContext } from "../../../shared/socket/featureContext"
import { parseRoomIdField } from "../../../shared/socket/parseRoomId"
import type { RoomErrorAck, RoomSuccessAck } from "../../../shared/types/contracts/partyRoom"
import { socketAck } from "../../../shared/types/socket/ack"
import type { RoomRemoveMemberPayload, RoomSetRolePayload } from "./contracts"
import { publishRoomMemberChange } from "./membership"
import { changeRoom, lockRoomOwner } from "./transaction"
import { isRoomMember, listRoomMemberIds } from "./views"

export function registerRoomOwnership({ io, socket, user }: FeatureContext): void {
    socket.on("room:setRole", async (data: RoomSetRolePayload, callback: unknown) => {
        const ack = socketAck<RoomSuccessAck | RoomErrorAck>(callback)
        const roomId = parseRoomIdField(data?.roomId)
        const target = parseRoomIdField(data?.userId)
        const role = data?.role
        if (!roomId || !target || target === user.id || (role !== "member" && role !== "moderator"))
            return ack?.({ err: "Некорректная роль" })
        try {
            const result = await pool.query(
                "UPDATE room_members rm SET role=$1 FROM rooms r WHERE r.id=rm.room_id AND r.created_by=$2 AND rm.room_id=$3 AND rm.user_id=$4 RETURNING rm.user_id",
                [role, user.id, roomId, target]
            )
            if (!result.rows.length) return ack?.({ err: "Изменять роли может только владелец комнаты" })
            ack?.({ success: true })
            io.to(String(target)).emit("room:membersChanged", { roomId })
        } catch {
            ack?.({ err: "Не удалось изменить роль" })
        }
    })

    socket.on("room:transferOwnership", async (data: RoomRemoveMemberPayload, callback: unknown) => {
        const ack = socketAck<RoomSuccessAck | RoomErrorAck>(callback)
        const roomId = parseRoomIdField(data?.roomId)
        const target = parseRoomIdField(data?.userId)
        if (!roomId || !target || target === user.id) return ack?.({ err: "Выберите другого участника" })
        try {
            const result = await changeRoom<RoomSuccessAck>(async (client) => {
                const owner = await lockRoomOwner(client, roomId)
                const member = await isRoomMember(roomId, target, client)
                if (owner !== user.id || !member)
                    return { err: "Передать владение может только владелец текущему участнику" }
                const { limits } = await getLimitsForUser(target, client)
                const { rows } = await client.query<{ n: number }>(
                    "SELECT COUNT(*)::int AS n FROM room_members WHERE room_id=$1",
                    [roomId]
                )
                if (rows[0].n > limits.maxRoomMembers)
                    return { err: "Тариф нового владельца не позволяет сохранить всех участников" }
                await client.query("UPDATE rooms SET created_by=$1 WHERE id=$2", [target, roomId])
                return { success: true }
            })
            if ("err" in result) return ack?.(result)
            publishRoomMemberChange(io, roomId, await listRoomMemberIds(roomId))
            ack?.(result)
        } catch {
            ack?.({ err: "Не удалось передать владение" })
        }
    })
}
