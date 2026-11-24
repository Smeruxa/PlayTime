import express from "express"
import { pool, redis, JWT_SECRET } from "../../shared/config"
import { createAuthRateLimiters } from "../http/authRateLimits"
import { normalizeEmail } from "../../shared/auth/passwordPolicy"
import { sendEmailVerification } from "../auth/emailVerification"
import { createEmailCodeLimits } from "../auth/emailCodeLimits"
import { isRecoveryCodeFormat, matchesRecoveryCode } from "../auth/recoveryCode"
import { isRecoveryMailConfigured } from "../services/recoveryMail"

const router = express.Router()
const { loginRegisterLimiter } = createAuthRateLimiters(redis)
const codeLimits = createEmailCodeLimits(redis, JWT_SECRET)
const INVALID_CODE = "Неверный или просроченный код. Запросите новый."
router.post("/email-verification/request", loginRegisterLimiter, async (req, res) => {
    if (!isRecoveryMailConfigured()) return res.status(503).json({ error: "Отправка писем временно недоступна" })
    const email = normalizeEmail(req.body?.email)
    if (!email || email.length > 254) return res.status(400).json({ error: "Введите почту аккаунта" })
    try {
        const row = (await pool.query("SELECT id,email FROM users WHERE email=$1 AND email_verified_at IS NULL AND is_blocked=FALSE AND (is_guest=FALSE OR guest_registration_pending=TRUE)", [email])).rows[0]
        res.json({ ok: true })
        if (row) void sendEmailVerification(row.id, row.email).catch(() => console.error("Verification email could not be delivered"))
    } catch { if (!res.headersSent) res.status(503).json({ error: "Не удалось запросить код" }) }
})
router.post("/email-verification/confirm", loginRegisterLimiter, async (req, res) => {
    const email = normalizeEmail(req.body?.email), code = typeof req.body?.code === "string" ? req.body.code.trim().toUpperCase() : ""
    if (!email || email.length > 254 || !isRecoveryCodeFormat(code)) return res.status(400).json({ error: "Введите код из письма: 6 цифр" })
    const client = await pool.connect()
    try {
        await client.query("BEGIN")
        const user = (await client.query("SELECT id FROM users WHERE email=$1 AND is_blocked=FALSE AND email_verified_at IS NULL FOR UPDATE", [email])).rows[0]
        const row = user ? (await client.query("SELECT c.* FROM email_verification_codes c WHERE c.user_id=$1 AND c.email=$2 AND c.expires_at>NOW() FOR UPDATE", [user.id, email])).rows[0] : undefined
        if (!row || row.attempts >= 5 || !(await codeLimits.canTry("verification", row.user_id))) {
            await client.query("COMMIT")
            return res.status(400).json({ error: INVALID_CODE })
        }
        if (!matchesRecoveryCode(code, row.code_hash, JWT_SECRET + ":email-verification")) {
            await codeLimits.recordFailure("verification", row.user_id)
            await client.query("UPDATE email_verification_codes SET attempts=attempts+1 WHERE user_id=$1", [row.user_id])
            await client.query("COMMIT")
            return res.status(400).json({ error: INVALID_CODE })
        }
        await client.query("UPDATE users SET email_verified_at=NOW(), is_guest=FALSE, guest_registration_pending=FALSE WHERE id=$1", [row.user_id])
        await client.query("DELETE FROM email_verification_codes WHERE user_id=$1", [row.user_id])
        await client.query("COMMIT")
        res.json({ ok: true })
    } catch { await client.query("ROLLBACK"); res.status(503).json({ error: "Не удалось подтвердить почту" }) }
    finally { client.release() }
})
export default router
