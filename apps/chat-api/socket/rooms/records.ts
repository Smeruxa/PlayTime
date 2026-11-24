import type { FeatureContext } from "../../../shared/socket/featureContext"
import { parseRoomIdField } from "../../../shared/socket/parseRoomId"
import type {
    RoomCreateAck,
    RoomCreateSuccessAck,
    RoomErrorAck,
    RoomRenameSuccessAck,
    RoomSuccessAck
} from "../../../shared/types/contracts/partyRoom"
import { socketAck } from "../../../shared/types/socket/ack"
import type { RoomCreatePayload, RoomIdPayload, RoomRenamePayload } from "./contracts"
import { changeRoom, lockRoomOwner } from "./transaction"
import { listRoomMemberIds } from "./views"

type RoomWithRecipients = RoomSuccessAck & { members: number[] }

export function registerRoomRecords({ io, socket, user }: FeatureContext): void {
    socket.on("room:create", async (data: RoomCreatePayload, callback: unknown) => {
        const ack = socketAck<RoomCreateAck>(callback)
        try {
            const name = data?.name != null ? String(data.name).trim() : ""
            if (name.length < 3 || name.length > 15)
                return ack?.({ err: "Название комнаты должно быть от 3 до 15 символов" })
            if (name === "Выберите пользователя") return ack?.({ err: "Недопустимое название комнаты." })

            const result = await changeRoom<RoomCreateSuccessAck>(async (client) => {
                await client.query("SELECT pg_advisory_xact_lock(1919247400, $1)", [user.id])
                const owned = await client.query<{ n: number }>(
                    "SELECT COUNT(*)::int AS n FROM rooms WHERE created_by=$1",
                    [user.id]
                )
                if (owned.rows[0].n >= 20) return { err: "Можно создать не больше 20 комнат. Удалите ненужные." }
                const { rows } = await client.query<{ id: number }>(
                    "INSERT INTO rooms(name,created_by) VALUES ($1,$2) RETURNING id",
                    [name, user.id]
                )
                const roomId = rows[0].id
                await client.query("INSERT INTO room_members(room_id,user_id) VALUES ($1,$2)", [roomId, user.id])
                return { success: true, roomId, name }
            })
            ack?.(result)
        } catch (error) {
            console.error("room:create", error)
            ack?.({ err: "Ошибка создания комнаты" })
        }
    })

    socket.on("room:rename", async (data: RoomRenamePayload, callback: unknown) => {
        const ack = socketAck<RoomRenameSuccessAck | RoomErrorAck>(callback)
        try {
            const roomId = parseRoomIdField(data?.roomId)
            const name = data?.name != null ? String(data.name).trim() : ""
            if (!roomId || name.length < 3 || name.length > 15) return ack?.({ err: "Название от 3 до 15 символов" })

            const result = await changeRoom<RoomWithRecipients>(async (client) => {
                const owner = await lockRoomOwner(client, roomId)
                if (owner === null) return { err: "Комната не найдена" }
                if (owner !== user.id) return { err: "Переименовать может только создатель" }
                await client.query("UPDATE rooms SET name = $1 WHERE id = $2", [name, roomId])
                return { success: true, members: await listRoomMemberIds(roomId, client) }
            })
            if ("err" in result) return ack?.(result)
            for (const member of result.members) io.to(String(member)).emit("room:renamed", { roomId, name })
            ack?.({ success: true, name })
        } catch (error) {
            console.error("room:rename", error)
            ack?.({ err: "Ошибка" })
        }
    })

    socket.on("room:delete", async (data: RoomIdPayload, callback: unknown) => {
        const ack = socketAck<RoomSuccessAck | RoomErrorAck>(callback)
        try {
            const roomId = parseRoomIdField(data?.roomId)
            if (!roomId) return ack?.({ err: "Некорректные данные" })
            const result = await changeRoom<RoomWithRecipients>(async (client) => {
                const owner = await lockRoomOwner(client, roomId)
                if (owner === null) return { err: "Комната не найдена" }
                if (owner !== user.id) return { err: "Удалить может только создатель комнаты" }
                const members = await listRoomMemberIds(roomId, client)
                await client.query("DELETE FROM rooms WHERE id = $1", [roomId])
                return { success: true, members }
            })
            if ("err" in result) return ack?.(result)
            const room = `room:${roomId}`
            io.to(room).emit("party:roomClosed", { roomId })
            io.in(room).socketsLeave(room)
            for (const member of result.members) io.to(String(member)).emit("room:removed", { roomId })
            socket.leave(room)
            ack?.({ success: true })
        } catch (error) {
            console.error("room:delete", error)
            ack?.({ err: "Ошибка удаления" })
        }
    })
}
