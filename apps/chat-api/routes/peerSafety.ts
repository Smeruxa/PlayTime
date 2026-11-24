import { resolvePeer } from "../socket/peerIdentity"
import express from "express"
import { pool, redis } from "../../shared/config"
import { bearerAuthMiddleware, type AuthedRequest } from "../../shared/http/bearerAuth"
import { blockPeer, type PeerBlockEffects } from "../services/peerBlock"

const router = express.Router()
router.use(bearerAuthMiddleware)
router.get("/blocked", async (req, res) => {
    try {
        const rows = await pool.query(
            "SELECT u.id AS user_id, COALESCE(u.guest_original_username, u.username) AS username, (u.guest_archived_at IS NOT NULL) AS archived FROM user_blocks b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=$1 ORDER BY u.username LIMIT 500",
            [(req as AuthedRequest).userId]
        )
        res.json({ usernames: rows.rows.map((row) => row.username), peers: rows.rows })
    } catch {
        res.status(503).json({ error: "Не удалось получить список блокировок" })
    }
})
router.post("/:username/:action", async (req, res) => {
    const action = req.params.action,
        name = req.params.username
    if (!["block", "unblock", "report"].includes(action) || name.length > 50)
        return res.status(400).json({ error: "Некорректное действие" })
    const uid = (req as unknown as AuthedRequest).userId
    try {
        const attempts = await redis.incr(`safety:${uid}:${action}`)
        if (attempts === 1) await redis.expire(`safety:${uid}:${action}`, 3600)
        if (attempts > (action === "report" ? 10 : 60))
            return res.status(429).json({ error: "Слишком много действий. Повторите позже." })
        const peer = await resolvePeer(req.body?.peerUserId, name, { allowArchived: true })
        if (!peer || peer.id === uid) return res.status(400).json({ error: "Пользователь не найден" })
        if (action === "report") {
            const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : ""
            if (reason.length < 5 || reason.length > 1000)
                return res.status(400).json({ error: "Опишите причину: от 5 до 1000 символов" })
            await pool.query("INSERT INTO user_reports(reporter_id,reported_id,reason) VALUES ($1,$2,$3)", [
                uid,
                peer.id,
                reason
            ])
        } else if (action === "unblock") {
            await pool.query("DELETE FROM user_blocks WHERE blocker_id=$1 AND blocked_id=$2", [uid, peer.id])
            await pool.query(
                "DELETE FROM friendships WHERE status='blocked' AND ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1))",
                [uid, peer.id]
            )
        } else {
            const effects = req.app.locals?.peerBlockEffects as PeerBlockEffects | undefined
            if (!effects) throw new Error("Peer block effects unavailable")
            await blockPeer(
                req.app.get("io"),
                { id: uid, username: (req as unknown as AuthedRequest).username },
                { id: peer.id, username: peer.username },
                effects
            )
        }
        res.json({ ok: true })
    } catch {
        res.status(503).json({ error: "Не удалось выполнить действие" })
    }
})

export default router
