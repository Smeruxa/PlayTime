import { pool } from "../../../shared/deps"
import type { FeatureContext } from "../../../shared/socket/featureContext"
import { parseRoomIdField } from "../../../shared/socket/parseRoomId"
import type { RoomGetAck, RoomGetSuccessPayload } from "../../../shared/types/contracts/partyRoom"
import type { RowRoomListEntry, RowRoomMember, RowRoomMemberUserId } from "../../../shared/types/db"
import { socketAck } from "../../../shared/types/socket/ack"
import type { RoomIdPayload, RoomRole } from "./contracts"
import type { RoomDatabase } from "./transaction"

export async function isRoomMember(roomId: number, userId: number, db: RoomDatabase = pool): Promise<boolean> {
    const { rows } = await db.query("SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2", [roomId, userId])
    return rows.length > 0
}

export async function listRoomMemberIds(roomId: number, db: RoomDatabase = pool): Promise<number[]> {
    const { rows } = await db.query<RowRoomMemberUserId>("SELECT user_id FROM room_members WHERE room_id = $1", [
        roomId
    ])
    return rows.map(({ user_id }) => user_id)
}

export function registerRoomViews({ socket, user }: FeatureContext): void {
    socket.on("room:list", async (_: unknown, callback: unknown) => {
        const ack = socketAck<RowRoomListEntry[]>(callback)
        try {
            const { rows } = await pool.query<RowRoomListEntry>(
                "SELECT r.id, r.name, r.created_by FROM rooms r JOIN room_members rm ON r.id = rm.room_id WHERE rm.user_id = $1 ORDER BY r.name",
                [user.id]
            )
            ack?.(rows)
        } catch (error) {
            console.error("room:list", error)
            ack?.([])
        }
    })

    socket.on("room:get", async (data: RoomIdPayload, callback: unknown) => {
        const ack = socketAck<RoomGetAck>(callback)
        if (!ack) return
        try {
            const roomId = parseRoomIdField(data?.roomId)
            if (!roomId) return ack({ err: "Invalid room" })
            if (!(await isRoomMember(roomId, user.id))) return ack({ err: "Not a member" })
            const room = await pool.query<Pick<RoomGetSuccessPayload, "id" | "name" | "created_by">>(
                "SELECT id, name, created_by FROM rooms WHERE id = $1",
                [roomId]
            )
            if (!room.rows.length) return ack({ err: "Room not found" })
            const members = await pool.query<RowRoomMember & { role: RoomRole }>(
                "SELECT u.id, COALESCE(u.guest_original_username, u.username) AS username, rm.role FROM users u JOIN room_members rm ON u.id = rm.user_id WHERE rm.room_id = $1",
                [roomId]
            )
            const { id, name, created_by } = room.rows[0]
            ack({ id, name, created_by, myId: user.id, members: members.rows })
        } catch (error) {
            console.error("room:get", error)
            ack({ err: "Server error" })
        }
    })
}
