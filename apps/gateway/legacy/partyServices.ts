import { pool } from "../../shared/deps"
import { getRoomPlanLimits } from "../subscription/subscriptionService"
import type { PartyRoomServices } from "../../room-api/socket/party/roomsSocket"

export const localPartyServices: PartyRoomServices = {
    isMember: async (roomId, userId) =>
        (await pool.query("SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2", [roomId, userId])).rows
            .length > 0,
    limits: async (roomId) => (await getRoomPlanLimits(roomId))?.limits ?? null
}
