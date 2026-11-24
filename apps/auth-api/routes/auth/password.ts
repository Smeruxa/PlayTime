import { Router, type RequestHandler } from "express"
import bcrypt from "bcrypt"
import { randomUUID } from "node:crypto"
import { sendEmailVerification } from "../../auth/emailVerification"
import { getAccessTokenTtlSeconds, issueRefreshToken, signUserAccessToken } from "../../auth"
import { getSessionVersion } from "../../auth/sessionVersion"
import { isRecoveryMailConfigured } from "../../services/recoveryMail"
import { normalizeEmail, passwordPolicyError } from "../../../shared/auth/passwordPolicy"
import { pool, redis } from "../../../shared/config"
import { accountView, isReasonableEmail, LOGIN_THROTTLED, REGISTRATION_CONFLICT, type AccountRow } from "./account"

const LOGIN_FAILED = "Неверный email или пароль."
const DUMMY_PASSWORD_HASH = "$2b$12$P5bISz6d2GgbNJIPjZQWVuHg0azV35p8xgh4THNtoYWRJa0yh5pXu"

type LoginAccount = AccountRow & {
    password_hash: string
    is_blocked?: boolean
    email_verified_at?: Date | null
}

const register: RequestHandler = async (req, res) => {
    const {
        username,
        email: rawEmail,
        password
    } = req.body as {
        username?: string
        email?: string
        password?: string
    }
    const email = normalizeEmail(rawEmail)
    const policyError = passwordPolicyError(password)
    if (policyError) return res.status(400).json({ error: policyError })
    if (typeof username !== "string" || username.length < 3 || username.length > 50)
        return res.status(400).json({ error: "Никнейм должен содержать от 3 до 15 символов" })
    if (!isReasonableEmail(email ?? "")) return res.status(400).json({ error: "Некорректный email." })
    if (username === "Выберите пользователя" || /[\s\u200B-\u200D\uFEFF]/.test(username ?? ""))
        return res.status(400).json({ error: "Недопустимый никнейм." })
    if ((username ?? "").length > 15) return res.status(400).json({ error: "Недопустимая длина никнейма." })

    if (!isRecoveryMailConfigured())
        return res
            .status(503)
            .json({ error: "Регистрация временно недоступна: не удаётся отправить письмо подтверждения" })
    const registrationKey = `register_lock:${req.ip || req.socket.remoteAddress}`
    const reservation = randomUUID()
    let reserved = false
    try {
        reserved = !!(await redis.set(registrationKey, reservation, "EX", 60, "NX"))
        if (!reserved) return res.status(429).json({ error: "Новый аккаунт можно создать через минуту." })

        const hash = await bcrypt.hash(password!, 12)
        const result = await pool.query(
            "INSERT INTO users (username, email, password_hash, email_verified_at) VALUES ($1, $2, $3, NULL) RETURNING id, username, email",
            [username, email, hash]
        )

        reserved = false
        res.json({ user: result.rows[0], verificationRequired: true })
        void sendEmailVerification(result.rows[0].id, email).catch(() =>
            console.error("Verification email could not be delivered")
        )
    } catch (error) {
        if (reserved) {
            await redis.eval("if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end", 1, registrationKey, reservation).catch(() => {})
        }
        if ((error as { code?: string }).code === "23505")
            return res.status(409).json({ error: REGISTRATION_CONFLICT })
        res.status(503).json({ error: "Не удалось зарегистрировать аккаунт. Попробуйте ещё раз." })
    }
}

const login: RequestHandler = async (req, res) => {
    const { email: rawEmail, password } = req.body as { email?: string; password?: string }
    const email = normalizeEmail(rawEmail)
    if (typeof password !== "string" || password.length < 1 || password.length > 50)
        return res.status(401).json({ error: LOGIN_FAILED })
    if (!isReasonableEmail(email ?? "")) return res.status(401).json({ error: LOGIN_FAILED })

    try {
        const ip = req.ip || req.socket.remoteAddress
        const key = `login_attempts:${email}:${ip}`
        const blockKey = `blocked:${email}:${ip}`

        const blocked = await redis.ttl(blockKey)
        if (blocked > 0) return res.status(429).json({ error: LOGIN_THROTTLED })

        const recordFailedAttempt = async (): Promise<boolean> => {
            const attempts = await redis.incr(key)
            if (attempts === 1) await redis.expire(key, 3600)
            if (attempts >= 5) {
                await redis.set(blockKey, 1, "EX", 3600)
                await redis.del(key)
                return true
            }
            return false
        }

        const result = await pool.query<LoginAccount>("SELECT * FROM users WHERE email=$1", [email])
        const user = result.rows[0]
        const sessionVersion = user ? await getSessionVersion(user.id) : 0
        const current = user
            ? await pool.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [user.id])
            : null
        const passwordHash = current?.rows[0]?.password_hash
        const match = await bcrypt.compare(password, passwordHash ?? DUMMY_PASSWORD_HASH)
        if (!user || !passwordHash || !match) {
            if (await recordFailedAttempt()) return res.status(429).json({ error: LOGIN_THROTTLED })
            return res.status(401).json({ error: LOGIN_FAILED })
        }

        if (user.is_blocked === true) {
            return res.status(403).json({ error: "Учётная запись заблокирована администратором." })
        }
        const lockTtl = await redis.ttl(`acct_locked:${user.id}`)
        if (lockTtl > 0) return res.status(429).json({ error: LOGIN_THROTTLED })

        await redis.del(key)
        if (user.email_verified_at === null)
            return res.status(403).json({ error: "Подтвердите почту кодом из письма", verificationRequired: true })
        const session = { id: user.id, username: user.username, sessionVersion }
        const refreshToken = await issueRefreshToken(session, {
            userAgent: req.get("user-agent"),
            deviceName: req.get("x-playtime-device")
        })
        const token = signUserAccessToken(session)
        res.json({
            token,
            refreshToken,
            expiresIn: getAccessTokenTtlSeconds(),
            user: accountView(user)
        })
    } catch (err) {
        console.error("login error:", err)
        res.status(500).json({ error: "Server error" })
    }
}

export function createPasswordRoutes(limiter: RequestHandler) {
    const router = Router()
    router.post("/register", limiter, register)
    router.post("/login", limiter, login)
    return router
}
