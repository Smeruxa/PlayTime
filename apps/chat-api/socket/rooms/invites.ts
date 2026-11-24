import { getLimitsForUser } from "../../../database/subscriptionPlans"
import { pool } from "../../../shared/deps"
import type { FeatureContext } from "../../../shared/socket/featureContext"
import { parseRoomIdField } from "../../../shared/socket/parseRoomId"
import type { RoomErrorAck, RoomSuccessAck } from "../../../shared/types/contracts/partyRoom"
import { socketAck } from "../../../shared/types/socket/ack"
import { resolvePeer } from "../peerIdentity"
import type { RoomAddMemberPayload, RoomRole } from "./contracts"
import { publishRoomMemberChange } from "./membership"
import { changeRoom, lockRoomOwner } from "./transaction"
import { isRoomMember, listRoomMemberIds } from "./views"

type InviteOutcome = RoomSuccessAck & { added: boolean }

async function addRoomMember(
    roomId: number,
    inviterId: number,
    recipientId: number
): Promise<InviteOutcome | RoomErrorAck> {
    try {
        return await changeRoom<InviteOutcome>(async (client) => {
            const owner = await lockRoomOwner(client, roomId)
            if (owner === null) return { err: "Комната не найдена" }
            const inviter = await client.query<{ role: RoomRole }>(
                "SELECT role FROM room_members WHERE room_id=$1 AND user_id=$2",
                [roomId, inviterId]
            )
            if (owner !== inviterId && inviter.rows[0]?.role !== "moderator")
                return { err: "Добавлять участников может владелец или назначенный им модератор" }

            const memberships = await client.query<{ n: number }>(
                "SELECT COUNT(*)::int AS n FROM room_members WHERE user_id=$1",
                [recipientId]
            )
            if (memberships.rows[0].n >= 100) return { err: "У пользователя уже 100 комнат" }
            const { limits } = await getLimitsForUser(owner, client)
            if (await isRoomMember(roomId, recipientId, client)) return { success: true, added: false }

            const count = await client.query<{ c: number }>(
                "SELECT COUNT(*)::int AS c FROM room_members WHERE room_id = $1",
                [roomId]
            )
            const maxMembers = limits.maxRoomMembers
            if ((count.rows[0]?.c ?? 0) >= maxMembers)
                return {
                    err: `Лимит участников комнаты для тарифа владельца (${maxMembers}). Обновите тариф или создайте новую комнату.`
                }

            await client.query("INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)", [roomId, recipientId])
            return { success: true, added: true }
        })
    } catch (error) {
        console.error("room:addMember tx", error)
        return { err: "Ошибка добавления" }
    }
}

export function registerRoomInvites({ io, socket, user }: FeatureContext): void {
    socket.on("room:addMember", async (data: RoomAddMemberPayload, callback: unknown) => {
        const ack = socketAck<RoomSuccessAck | RoomErrorAck>(callback)
        if (!ack) return
        try {
            const roomId = parseRoomIdField(data?.roomId)
            if (!roomId) return ack({ err: "Invalid data" })
            const suppliedId = data?.peerUserId !== undefined ? data.peerUserId : data?.userId
            const peer = await resolvePeer(suppliedId, data?.username)
            if (!peer) return ack({ err: "Пользователь не найден" })
            if (!(await isRoomMember(roomId, user.id))) return ack({ err: "Вы не участник комнаты" })
            const friends = await pool.query(
                "SELECT 1 FROM friendships WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)) AND status = 'accepted'",
                [user.id, peer.id]
            )
            if (!friends.rows.length) return ack({ err: "Добавлять можно только друзей" })

            const result = await addRoomMember(roomId, user.id, peer.id)
            if ("err" in result) return ack(result)
            if (result.added) {
                io.to(String(peer.id)).emit("room:invite", { roomId })
                const { rows } = await pool.query<{ username: string }>("SELECT username FROM users WHERE id = $1", [
                    peer.id
                ])
                const username = rows[0]?.username ?? ""
                const members = await listRoomMemberIds(roomId)
                for (const member of members) {
                    io.to(String(member)).emit("room:e2eeNeedWrap", { roomId, newUserId: peer.id, username })
                }
                publishRoomMemberChange(io, roomId, members)
            }
            ack({ success: true })
        } catch (error) {
            console.error("room:addMember", error)
            ack({ err: "Ошибка добавления" })
        }
    })
}
