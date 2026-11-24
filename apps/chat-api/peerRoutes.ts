import { Router } from "express"
import {
    isDatabaseId,
    isUserIdList,
    requestFields,
    type ChatPeer,
    type ChatResponse
} from "../shared/runtime/chatContracts"
import { pool } from "../shared/deps"
import { resolvePeer } from "./socket/peerIdentity"

export async function listPresenceFriends(userId: number): Promise<ChatPeer[]> {
    const { rows } = await pool.query<ChatPeer>(
        `SELECT u.id, u.username FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
         WHERE (f.user_id = $1 OR f.friend_id = $1) AND f.status = 'accepted'`,
        [userId]
    )
    return rows
}

export function makePeerRoutes() {
    const router = Router()

    router.post("/peer", async (req, res) => {
        const { peerUserId, username } = requestFields(req.body)
        const peer = await resolvePeer(peerUserId, username)
        return res.json({ peer: peer && { id: peer.id, username: peer.username } } satisfies ChatResponse<"peer">)
    })

    router.post("/users", async (req, res) => {
        const { userIds } = requestFields(req.body)
        if (!isUserIdList(userIds)) return res.sendStatus(400)
        const { rows } = await pool.query<ChatPeer>(
            "SELECT id, COALESCE(guest_original_username, username) AS username FROM users WHERE id = ANY($1::int[])",
            [userIds]
        )
        return res.json({ users: rows } satisfies ChatResponse<"users">)
    })

    router.post("/presence-friends", async (req, res) => {
        const { userId } = requestFields(req.body)
        if (!isDatabaseId(userId)) return res.sendStatus(400)
        const friends = await listPresenceFriends(userId)
        return res.json({ friends } satisfies ChatResponse<"presence-friends">)
    })

    return router
}
