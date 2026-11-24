import express, { type Request } from "express"
import crypto from "node:crypto"
import rateLimit from "express-rate-limit"
import { RedisStore, type RedisReply } from "rate-limit-redis"
import type { PoolClient } from "pg"
import { pool, redis } from "../../shared/config"
import { bearerAuthMiddleware, type AuthedRequest } from "../http/bearerAuthMiddleware"
import { deviceSessionRoom } from "../auth/sessionVersion"
import { isRecoveryCodeFormat, newRecoveryCode } from "../auth/recoveryCode"
import { matchesSessionRevocationCode, sessionRevocationCodeHash } from "../auth/sessionRevocationCode"
import { isRecoveryMailConfigured, sendRecoveryMail } from "../services/recoveryMail"

const router = express.Router()
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const INVALID_CODE = "Неверный или просроченный код. Запросите новый код для этого действия."
const limiter = (prefix: string, windowMs: number, limit: number) =>
    rateLimit({
        windowMs,
        limit,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => String((req as AuthedRequest).userId),
        store: new RedisStore({
            prefix,
            sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<RedisReply>
        }),
        message: { error: "Слишком много попыток. Попробуйте позже." }
    })
const requestLimiter = limiter("rl:session-code:request:", 60 * 60_000, 10)
const confirmLimiter = limiter("rl:session-code:confirm:", 15 * 60_000, 30)
router.use(bearerAuthMiddleware)
router.get("/", async (req, res) => {
    try {
        const uid = (req as AuthedRequest).userId
        const session = (req as AuthedRequest).accessSession
        const result = await pool.query(
            "SELECT id, device_name, created_at, last_seen_at FROM auth_sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW() ORDER BY last_seen_at DESC LIMIT 100",
            [uid]
        )
        res.json({
            sessions: result.rows.map((row) => ({
                id: row.id,
                deviceName: row.device_name,
                createdAt: row.created_at,
                lastSeenAt: row.last_seen_at,
                current: row.id === session.sessionId
            }))
        })
    } catch {
        res.status(503).json({ error: "Не удалось загрузить устройства" })
    }
})
router.post("/revocation-code", requestLimiter, async (req, res) => {
    const actor = (req as AuthedRequest).accessSession
    if (!actor.sessionId) return res.status(409).json({ error: "Войдите снова для управления устройствами" })
    const allOthers = req.body?.allOthers === true
    const rawId = req.body?.sessionId
    if ((allOthers && rawId != null) || (!allOthers && (typeof rawId !== "string" || !UUID.test(rawId))))
        return res.status(400).json({ error: "Выберите устройство для отключения" })
    const targetSessionId = allOthers ? null : (rawId as string).toLowerCase()
    const id = crypto.randomUUID(),
        cooldown = `session-revocation:sent:${actor.id}`
    let locked = false
    try {
        const user = (await pool.query("SELECT email FROM users WHERE id=$1 AND is_blocked=FALSE", [actor.id])).rows[0]
        if (!user) return res.status(401).json({ error: "Войдите в аккаунт снова" })
        const devices = targetSessionId
            ? await pool.query(
                  "SELECT device_name FROM auth_sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>NOW()",
                  [targetSessionId, actor.id]
              )
            : await pool.query(
                  "SELECT device_name FROM auth_sessions WHERE id<>$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>NOW() LIMIT 1",
                  [actor.sessionId, actor.id]
              )
        if (!devices.rows.length)
            return res
                .status(404)
                .json({ error: targetSessionId ? "Устройство не найдено" : "Других активных сеансов нет" })
        if (!isRecoveryMailConfigured()) return res.status(503).json({ error: "Отправка писем временно недоступна" })
        locked = !!(await redis.set(cooldown, id, "EX", 60, "NX"))
        if (!locked)
            return res
                .status(429)
                .json({
                    error: "Повторный код можно запросить через минуту",
                    retryAfter: Math.max(1, await redis.ttl(cooldown))
                })
        const code = newRecoveryCode(),
            scope = { userId: actor.id, requesterSessionId: actor.sessionId, targetSessionId }
        await pool.query("DELETE FROM session_revocation_codes WHERE expires_at < NOW()")
        const result = await pool.query(
            `INSERT INTO session_revocation_codes(id,user_id,requester_session_id,target_session_id,code_hash,expires_at)
            VALUES($1,$2,$3,$4,$5,NOW()+INTERVAL '10 minutes')
            ON CONFLICT(requester_session_id) DO UPDATE SET id=EXCLUDED.id,target_session_id=EXCLUDED.target_session_id,code_hash=EXCLUDED.code_hash,attempts=0,expires_at=EXCLUDED.expires_at,created_at=NOW() RETURNING expires_at`,
            [id, actor.id, actor.sessionId, targetSessionId, sessionRevocationCodeHash(code, id, scope)]
        )
        await sendRecoveryMail(
            user.email,
            code,
            "session-revocation",
            targetSessionId ? devices.rows[0].device_name : "все остальные устройства"
        )
        const [local, domain] = String(user.email).split("@")
        res.json({
            challengeId: id,
            email: `${local.slice(0, 2)}***@${domain}`,
            expiresAt: result.rows[0].expires_at,
            retryAfter: 60
        })
    } catch {
        if (locked) {
            await pool.query("DELETE FROM session_revocation_codes WHERE id=$1", [id]).catch(() => {})
            await redis
                .eval(
                    "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
                    1,
                    cooldown,
                    id
                )
                .catch(() => {})
        }
        res.status(503).json({ error: "Не удалось отправить код. Попробуйте ещё раз." })
    }
})

async function revoke(req: Request, targetSessionId: string | null) {
    const actor = (req as AuthedRequest).accessSession
    if (!actor.sessionId) return { status: 409, error: "Войдите снова для управления устройствами" }
    let client: PoolClient | undefined
    try {
        client = await pool.connect()
        await client.query("BEGIN")
        const fail = async (status: number, error: string) => {
            await client!.query("COMMIT")
            return { status, error }
        }
        const active = await client.query(
            "SELECT 1 FROM auth_sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>NOW() FOR UPDATE",
            [actor.sessionId, actor.id]
        )
        if (!active.rows.length) return await fail(401, "Войдите в аккаунт снова")
        if (
            targetSessionId &&
            !(
                await client.query(
                    "SELECT 1 FROM auth_sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>NOW()",
                    [targetSessionId, actor.id]
                )
            ).rows.length
        )
            return await fail(404, "Устройство не найдено")
        const challengeId = req.body?.challengeId,
            code = typeof req.body?.code === "string" ? req.body.code.trim().toUpperCase() : ""
        if (typeof challengeId !== "string" || !UUID.test(challengeId) || !isRecoveryCodeFormat(code))
            return await fail(400, "Подтвердите отключение кодом из письма. При необходимости обновите PlayTime.")
        const row = (
            await client.query(
                "SELECT * FROM session_revocation_codes WHERE id=$1 AND user_id=$2 AND requester_session_id=$3 AND expires_at>NOW() FOR UPDATE",
                [challengeId, actor.id, actor.sessionId]
            )
        ).rows[0]
        if (!row || row.attempts >= 5 || row.target_session_id !== targetSessionId) return await fail(400, INVALID_CODE)
        if (
            !matchesSessionRevocationCode(code, row.code_hash, row.id, {
                userId: actor.id,
                requesterSessionId: actor.sessionId,
                targetSessionId
            })
        ) {
            await client.query("UPDATE session_revocation_codes SET attempts=attempts+1 WHERE id=$1", [row.id])
            return await fail(400, INVALID_CODE)
        }
        const result = targetSessionId
            ? await client.query(
                  "UPDATE auth_sessions SET revoked_at=NOW(),refresh_token_hash=NULL WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id",
                  [targetSessionId, actor.id]
              )
            : await client.query(
                  "UPDATE auth_sessions SET revoked_at=NOW(),refresh_token_hash=NULL WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL RETURNING id",
                  [actor.id, actor.sessionId]
              )
        await client.query("DELETE FROM session_revocation_codes WHERE id=$1", [row.id])
        await client.query("COMMIT")
        for (const device of result.rows) {
            req.app.get("io")?.to(deviceSessionRoom(device.id)).emit("session:revoked")
            req.app.get("io")?.in(deviceSessionRoom(device.id)).disconnectSockets(true)
        }
        return { status: 200 }
    } catch {
        await client?.query("ROLLBACK").catch(() => {})
        return { status: 503, error: "Не удалось завершить сеанс. Попробуйте ещё раз." }
    } finally {
        client?.release()
    }
}
router.post("/revoke-others", confirmLimiter, async (req, res) => {
    const result = await revoke(req, null)
    res.status(result.status).json(result.error ? { error: result.error } : { ok: true })
})
router.post("/:id/revoke", confirmLimiter, async (req, res) => {
    if (!UUID.test(String(req.params.id))) return res.status(400).json({ error: "Некорректное устройство" })
    const result = await revoke(req, String(req.params.id).toLowerCase())
    res.status(result.status).json(result.error ? { error: result.error } : { ok: true })
})
export default router
