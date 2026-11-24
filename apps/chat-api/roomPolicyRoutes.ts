import { Router } from "express"
import { isDatabaseId, isUserIdList, requestFields, type ChatResponse } from "../shared/runtime/chatContracts"
import { pool } from "../shared/deps"
import { peerEventRoom } from "./socket/peerIdentity"
import { getLimitsForUser, getRoomPlanLimits } from "../database/subscriptionPlans"

export function makeRoomPolicyRoutes() {
    const router = Router()

    router.post("/audience", async (req, res) => {
        const { recipientId, participantIds } = requestFields(req.body)
        if (!isDatabaseId(recipientId) || !isUserIdList(participantIds) || !participantIds.includes(recipientId))
            return res.sendStatus(400)
        return res.json({ room: await peerEventRoom(recipientId, participantIds) } satisfies ChatResponse<"audience">)
    })

    router.post("/relationship", async (req, res) => {
        const { userId, peerId } = requestFields(req.body)
        if (!isDatabaseId(userId) || !isDatabaseId(peerId)) return res.sendStatus(400)
        const { rows } = await pool.query<{ friends: boolean; blocked: boolean }>(
            `SELECT EXISTS (
                SELECT 1 FROM friendships
                WHERE status = 'accepted' AND ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))
            ) AS friends, EXISTS (
                SELECT 1 FROM user_blocks
                WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)
            ) AS blocked`,
            [userId, peerId]
        )
        const { friends, blocked } = rows[0]
        return res.json({ canCall: friends && !blocked, blocked } satisfies ChatResponse<"relationship">)
    })

    router.post("/membership", async (req, res) => {
        const { roomId, userId } = requestFields(req.body)
        if (!isDatabaseId(roomId) || !isDatabaseId(userId)) return res.sendStatus(400)
        const { rows } = await pool.query("SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2", [
            roomId,
            userId
        ])
        return res.json({ member: rows.length > 0 } satisfies ChatResponse<"membership">)
    })

    router.post("/limits", async (req, res) => {
        const { roomId, userId } = requestFields(req.body)
        const hasRoom = roomId !== undefined
        const hasUser = userId !== undefined
        const id = roomId ?? userId
        if (hasRoom === hasUser || !isDatabaseId(id)) return res.sendStatus(400)
        const plan = hasRoom ? await getRoomPlanLimits(id, pool) : await getLimitsForUser(id, pool)
        if (!plan) return res.json({ limits: null } satisfies ChatResponse<"limits">)
        const { maxPartySockets, maxScreenBroadcastFps } = plan.limits
        return res.json({ limits: { maxPartySockets, maxScreenBroadcastFps } } satisfies ChatResponse<"limits">)
    })

    return router
}
