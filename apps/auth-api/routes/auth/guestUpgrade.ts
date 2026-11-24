import type { RequestHandler } from "express"
import bcrypt from "bcrypt"
import { sendEmailVerification } from "../../auth/emailVerification"
import { isRecoveryMailConfigured } from "../../services/recoveryMail"
import { passwordPolicyError, normalizeEmail } from "../../../shared/auth/passwordPolicy"
import { pool, redis } from "../../../shared/config"
import { accountView, getBearerSession, isReasonableEmail, REGISTRATION_CONFLICT, type AccountRow } from "./account"

export const upgradeGuest: RequestHandler = async (req, res) => {
    const session = await getBearerSession(req.headers.authorization)
    if (!session) return res.status(401).json({ error: "Войдите в аккаунт снова" })
    const email = normalizeEmail(req.body?.email)
    const policyError = passwordPolicyError(req.body?.password)
    if (policyError) return res.status(400).json({ error: policyError })
    if (!isReasonableEmail(email)) return res.status(400).json({ error: "Некорректный email." })
    if (!isRecoveryMailConfigured())
        return res
            .status(503)
            .json({ error: "Регистрация временно недоступна: не удаётся отправить письмо подтверждения" })
    try {
        if ((await redis.ttl(`acct_locked:${session.id}`)) > 0)
            return res.status(403).json({ error: "Аккаунт временно заблокирован" })
        const current = (
            await pool.query<AccountRow>(
                "SELECT id, username, email, is_guest, guest_registration_pending FROM users WHERE id=$1 AND is_blocked=FALSE AND auth_version=$2",
                [session.id, session.sessionVersion]
            )
        ).rows[0]
        if (!current) return res.status(401).json({ error: "Войдите в аккаунт снова" })
        if (!current.is_guest) return res.status(409).json({ error: "Аккаунт уже зарегистрирован" })
        if (current.guest_registration_pending) {
            if (current.email !== email)
                return res.status(409).json({
                    error: "Сначала подтвердите почту, указанную при регистрации",
                    user: accountView(current),
                    verificationRequired: true
                })
            res.json({ user: accountView(current), verificationRequired: true })
            void sendEmailVerification(current.id, current.email).catch(() =>
                console.error("Verification email could not be delivered")
            )
            return
        }
        const passwordHash = await bcrypt.hash(req.body.password, 12)
        const updated = (
            await pool.query<AccountRow>(
                `UPDATE users SET email=$1, password_hash=$2, guest_registration_pending=TRUE
             WHERE id=$3 AND is_guest=TRUE AND guest_registration_pending=FALSE AND is_blocked=FALSE AND auth_version=$4
             AND ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM auth_sessions s WHERE s.id=$5 AND s.user_id=users.id AND s.revoked_at IS NULL AND s.expires_at>NOW()))
             AND NOT EXISTS (SELECT 1 FROM revoked_access_tokens r WHERE r.jti=$6 AND r.expires_at>NOW())
             AND $7 > EXTRACT(EPOCH FROM NOW())
             RETURNING id, username, email, is_guest, guest_registration_pending`,
                [
                    email,
                    passwordHash,
                    session.id,
                    session.sessionVersion,
                    session.sessionId ?? null,
                    session.jti,
                    session.exp
                ]
            )
        ).rows[0]
        if (!updated)
            return res
                .status(409)
                .json({ error: "Состояние аккаунта изменилось. Обновите страницу и попробуйте снова." })
        res.json({ user: accountView(updated), verificationRequired: true })
        void sendEmailVerification(updated.id, updated.email).catch(() =>
            console.error("Verification email could not be delivered")
        )
    } catch (error) {
        if ((error as { code?: string }).code === "23505")
            return res.status(409).json({ error: REGISTRATION_CONFLICT })
        console.error("guest upgrade failed")
        res.status(503).json({ error: "Не удалось зарегистрировать аккаунт. Попробуйте ещё раз." })
    }
}
