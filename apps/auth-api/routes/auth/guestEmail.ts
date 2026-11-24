import type { RequestHandler } from "express"
import bcrypt from "bcrypt"
import type { PoolClient } from "pg"
import { sendEmailVerification } from "../../auth/emailVerification"
import { isRecoveryMailConfigured } from "../../services/recoveryMail"
import { normalizeEmail } from "../../../shared/auth/passwordPolicy"
import { pool, redis } from "../../../shared/config"
import { accountView, getBearerSession, isReasonableEmail, type AccountRow } from "./account"

export const changeGuestEmail: RequestHandler = async (req, res) => {
    const session = await getBearerSession(req.headers.authorization)
    if (!session) return res.status(401).json({ error: "Войдите в аккаунт снова" })
    const email = normalizeEmail(req.body?.email)
    const password = req.body?.password
    if (!isReasonableEmail(email)) return res.status(400).json({ error: "Некорректный email." })
    if (typeof password !== "string" || password.length < 1 || password.length > 50)
        return res.status(400).json({ error: "Введите пароль, выбранный при регистрации" })
    if (!isRecoveryMailConfigured()) return res.status(503).json({ error: "Отправка писем временно недоступна" })
    let client: PoolClient | undefined
    try {
        if ((await redis.ttl(`acct_locked:${session.id}`)) > 0)
            return res.status(403).json({ error: "Аккаунт временно заблокирован" })
        const attemptsKey = `guest_email_attempts:${session.id}`
        const attempts = await redis.incr(attemptsKey)
        if (attempts === 1) await redis.expire(attemptsKey, 900)
        if (attempts > 5) return res.status(429).json({ error: "Слишком много попыток. Повторите через 15 минут." })
        const current = (
            await pool.query<AccountRow & { password_hash: string }>(
                "SELECT id, username, email, is_guest, guest_registration_pending, password_hash FROM users WHERE id=$1 AND is_blocked=FALSE AND auth_version=$2",
                [session.id, session.sessionVersion]
            )
        ).rows[0]
        if (!current) return res.status(401).json({ error: "Войдите в аккаунт снова" })
        if (!current.is_guest || !current.guest_registration_pending)
            return res.status(409).json({ error: "Исправить почту можно до завершения регистрации" })
        if (!(await bcrypt.compare(password, current.password_hash)))
            return res.status(403).json({ error: "Неверный пароль. Введите пароль, выбранный при регистрации." })
        client = await pool.connect()
        await client.query("BEGIN")
        const updated = (
            await client.query<AccountRow>(
                `UPDATE users SET email=$1
             WHERE id=$2 AND email=$3 AND password_hash=$4 AND is_guest=TRUE AND guest_registration_pending=TRUE
             AND email_verified_at IS NULL AND is_blocked=FALSE AND auth_version=$5
             AND ($6::uuid IS NULL OR EXISTS (SELECT 1 FROM auth_sessions s WHERE s.id=$6 AND s.user_id=users.id AND s.revoked_at IS NULL AND s.expires_at>NOW()))
             AND NOT EXISTS (SELECT 1 FROM revoked_access_tokens r WHERE r.jti=$7 AND r.expires_at>NOW())
             AND $8 > EXTRACT(EPOCH FROM NOW())
             RETURNING id, username, email, is_guest, guest_registration_pending`,
                [
                    email,
                    session.id,
                    current.email,
                    current.password_hash,
                    session.sessionVersion,
                    session.sessionId ?? null,
                    session.jti,
                    session.exp
                ]
            )
        ).rows[0]
        if (!updated) {
            await client.query("COMMIT")
            return res
                .status(409)
                .json({ error: "Состояние аккаунта изменилось. Обновите страницу и попробуйте снова." })
        }
        if (current.email !== email) {
            await client.query("DELETE FROM email_verification_codes WHERE user_id=$1", [session.id])
            await client.query("DELETE FROM password_recovery WHERE user_id=$1", [session.id])
        }
        await client.query("COMMIT")
        res.json({ user: accountView(updated), verificationRequired: true })
        void sendEmailVerification(updated.id, updated.email, current.email !== email).catch(() =>
            console.error("Verification email could not be delivered")
        )
    } catch (error) {
        await client?.query("ROLLBACK").catch(() => {})
        if ((error as { code?: string }).code === "23505")
            return res.status(409).json({ error: "Эта почта уже занята. Укажите другую почту." })
        console.error("guest email correction failed")
        res.status(503).json({ error: "Не удалось исправить почту. Попробуйте ещё раз." })
    } finally {
        client?.release()
    }
}
