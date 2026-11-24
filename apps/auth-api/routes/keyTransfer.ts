import express from "express"
import crypto from "node:crypto"
import { redis } from "../../shared/config"
import { bearerAuthMiddleware, type AuthedRequest } from "../http/bearerAuthMiddleware"

const router = express.Router()
router.use(bearerAuthMiddleware)
router.post("/", async (req, res) => {
    const { ciphertext, nonce } = req.body ?? {}
    if (typeof ciphertext !== "string" || ciphertext.length > 24000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext) || typeof nonce !== "string" || !/^[A-Za-z0-9+/]{32}$/.test(nonce)) return res.status(400).json({ error: "Некорректный пакет ключей" })
    try {
        const uid = (req as unknown as AuthedRequest).userId
        if (!await redis.set(`key-transfer:limit:${uid}`, "1", "EX", 60, "NX")) return res.status(429).json({ error: "Новый код можно создать через минуту" })
        const id = crypto.randomUUID()
        await redis.set(`key-transfer:${uid}:${id}`, JSON.stringify({ ciphertext, nonce }), "EX", 300)
        res.json({ id, expiresAt: Date.now() + 300_000 })
    } catch { res.status(503).json({ error: "Не удалось создать код переноса" }) }
})
router.post("/:id/consume", async (req, res) => {
    const id = req.params.id
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) return res.status(400).json({ error: "Неверный код переноса" })
    try {
        const uid = (req as unknown as AuthedRequest).userId
        const raw = await redis.eval("local v=redis.call('GET',KEYS[1]); if v then redis.call('DEL',KEYS[1]) end; return v", 1, `key-transfer:${uid}:${id}`) as string | null
        if (!raw) return res.status(404).json({ error: "Код истёк или уже использован. Создайте новый на первом устройстве." })
        res.json(JSON.parse(raw))
    } catch { res.status(503).json({ error: "Не удалось получить ключи" }) }
})
export default router
