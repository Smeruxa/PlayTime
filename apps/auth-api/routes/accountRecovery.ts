import express from "express"
import bcrypt from "bcrypt"
import rateLimit from "express-rate-limit"
import { RedisStore, type RedisReply } from "rate-limit-redis"
import { pool, redis, JWT_SECRET } from "../../shared/config"
import { isRecoveryMailConfigured, sendRecoveryMail } from "../services/recoveryMail"
import { isRecoveryCodeFormat, matchesRecoveryCode, newRecoveryCode, recoveryCodeHash } from "../auth/recoveryCode"
import { createEmailCodeLimits } from "../auth/emailCodeLimits"
import { revokeUserCredentials } from "../auth/sessionVersion"
import { passwordPolicyError, normalizeEmail } from "../../shared/auth/passwordPolicy"

const router = express.Router()
const limiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 15,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
        prefix: "rl:auth:recovery:",
        sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<RedisReply>
    }),
    message: { error: "Слишком много попыток. Повторите через 15 минут." }
})
const INVALID_CODE = "Неверный или просроченный код. Запросите новый код восстановления."
const codeLimits = createEmailCodeLimits(redis, JWT_SECRET)

type RecoveryAccount = { id: number; email: string }

export async function sendAccountRecoveryEmail(user: RecoveryAccount): Promise<void> {
    if (!(await redis.set(`recovery:sent:${user.id}`, "1", "EX", 60, "NX"))) return
    const code = newRecoveryCode()
    await pool.query("DELETE FROM password_recovery WHERE expires_at < NOW()")
    const client = await pool.connect()
    try {
        await client.query("BEGIN")
        const current = await client.query(
            "SELECT id FROM users WHERE id=$1 AND email=$2 AND is_blocked=FALSE AND (is_guest=FALSE OR guest_registration_pending=TRUE) FOR UPDATE",
            [user.id, user.email]
        )
        if (!current.rows.length || !(await codeLimits.canTry("recovery", user.id)) || !(await codeLimits.claimDelivery(user.email))) {
            await client.query("COMMIT")
            return
        }
        await client.query(
            `INSERT INTO password_recovery(user_id, code_hash, email, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '15 minutes')
            ON CONFLICT(user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, email=EXCLUDED.email, expires_at = EXCLUDED.expires_at, attempts = 0`,
            [user.id, recoveryCodeHash(code, JWT_SECRET), user.email]
        )
        await client.query("COMMIT")
    } catch (error) {
        await client.query("ROLLBACK")
        throw error
    } finally {
        client.release()
    }
    await sendRecoveryMail(user.email, code)
}

router.post("/recovery/request", limiter, async (req, res) => {
    if (!isRecoveryMailConfigured())
        return res.status(503).json({ error: "Отправка писем временно недоступна. Обратитесь в поддержку PlayTime." })
    const email = normalizeEmail(req.body?.email)
    if (!email || email.length > 254 || !email.includes("@"))
        return res.status(400).json({ error: "Введите корректный email" })
    try {
        const result = await pool.query<RecoveryAccount>(
            "SELECT id, email FROM users WHERE email = $1 AND is_blocked = FALSE AND (is_guest=FALSE OR guest_registration_pending=TRUE)",
            [email]
        )
        res.json({ ok: true, message: "Если аккаунт с этой почтой существует, на неё придёт код восстановления." })
        const user = result.rows[0]
        if (user) void sendAccountRecoveryEmail(user).catch(() => console.error("Recovery email could not be delivered"))
    } catch {
        if (!res.headersSent) res.status(503).json({ error: "Не удалось отправить код. Повторите позже." })
    }
})

router.post("/recovery/reset", limiter, async (req, res) => {
    const email = normalizeEmail(req.body?.email)
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : ""
    const password = req.body?.password
    const policyError = passwordPolicyError(password)
    if (policyError) return res.status(400).json({ error: policyError })
    if (!email || email.length > 254 || !isRecoveryCodeFormat(code))
        return res.status(400).json({ error: INVALID_CODE })
    const client = await pool.connect()
    let userId: number | null = null
    try {
        await client.query("BEGIN")
        const user = (await client.query("SELECT id FROM users WHERE email=$1 AND is_blocked=FALSE FOR UPDATE", [email])).rows[0]
        const result = user ? await client.query<{ user_id: number; code_hash: string; attempts: number }>(
            `SELECT r.user_id, r.code_hash, r.attempts FROM password_recovery r
            WHERE r.email=$1 AND r.user_id=$2 AND r.expires_at > NOW() FOR UPDATE`,
            [email, user.id]
        ) : { rows: [] }
        const row = result.rows[0]
        if (!row || row.attempts >= 5 || !(await codeLimits.canTry("recovery", row.user_id))) {
            await client.query("COMMIT")
            return res.status(400).json({ error: INVALID_CODE })
        }
        if (!matchesRecoveryCode(code, row.code_hash, JWT_SECRET)) {
            await codeLimits.recordFailure("recovery", row.user_id)
            await client.query("UPDATE password_recovery SET attempts = attempts + 1 WHERE user_id = $1", [row.user_id])
            await client.query("COMMIT")
            return res.status(400).json({ error: INVALID_CODE })
        }
        userId = row.user_id
        const hash = await bcrypt.hash(password, 12)
        await revokeUserCredentials(userId, client)
        await client.query("UPDATE users SET password_hash = $1, email_verified_at = COALESCE(email_verified_at, NOW()), is_guest=FALSE, guest_registration_pending=FALSE WHERE id = $2", [hash, userId])
        await client.query("DELETE FROM password_recovery WHERE user_id = $1", [userId])
        await client.query("UPDATE auth_sessions SET revoked_at=NOW(), refresh_token_hash=NULL WHERE user_id=$1 AND revoked_at IS NULL", [userId])
        await client.query("COMMIT")
        const io = req.app.get("io")
        if (io) {
            io.to(String(userId)).emit("session:revoked")
            io.in(String(userId)).disconnectSockets(true)
        }
        res.json({ ok: true })
    } catch {
        await client.query("ROLLBACK")
        res.status(503).json({
            error: "Не удалось изменить пароль. Попробуйте войти с новым паролем или запросите код снова."
        })
    } finally {
        client.release()
    }
})

export default router
