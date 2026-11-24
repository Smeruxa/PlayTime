import type { RequestHandler } from "express"
import bcrypt from "bcrypt"
import crypto from "node:crypto"
import {
    AuthRetryError,
    createGuestSession,
    getAccessTokenTtlSeconds,
    signUserAccessToken,
    validAuthRequestKey
} from "../../auth"
import { redis } from "../../../shared/config"
import { accountView, LOGIN_THROTTLED, validUsername } from "./account"

export const enterGuest: RequestHandler = async (req, res) => {
    const username = req.body?.username
    if (!validUsername(username))
        return res.status(400).json({ error: "Никнейм должен содержать от 3 до 15 символов без пробелов" })
    const requestKey = req.body?.requestKey
    if (requestKey !== undefined && !validAuthRequestKey(requestKey))
        return res.status(400).json({ error: "Invalid request key" })
    const registrationKey = `guest_register_lock:${req.ip || req.socket.remoteAddress}`
    const reservation = crypto.randomUUID()
    let reserved = false
    try {
        const { user, session, refreshToken } = await createGuestSession(
            username,
            requestKey,
            { userAgent: req.get("user-agent"), deviceName: req.get("x-playtime-device") },
            async () => {
                reserved = !!(await redis.set(registrationKey, reservation, "EX", 60, "NX"))
                if (!reserved) throw new AuthRetryError(429, "Новый быстрый аккаунт можно создать через минуту")
                return {
                    email: `guest-${crypto.randomBytes(24).toString("hex")}@guest.playtime.invalid`,
                    passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString("base64url"), 12)
                }
            },
            async (id) => {
                if ((await redis.ttl(`acct_locked:${id}`)) > 0) throw new AuthRetryError(401, LOGIN_THROTTLED)
            }
        )
        res.json({
            token: signUserAccessToken(session),
            refreshToken,
            expiresIn: getAccessTokenTtlSeconds(),
            user: accountView(user)
        })
    } catch (error) {
        if (reserved)
            await redis
                .eval(
                    "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
                    1,
                    registrationKey,
                    reservation
                )
                .catch(() => {})
        if (error instanceof AuthRetryError)
            return res.status(error.status).json({
                error: error.message,
                ...(error.retrySuperseded ? { retrySuperseded: true } : {}),
                ...(error.status === 429 ? { retryAfter: 60 } : {})
            })
        if ((error as { code?: string }).code === "23505")
            return res
                .status(409)
                .json({ error: "Этот никнейм уже занят. Выберите другой или войдите в свой аккаунт." })
        console.error("guest registration failed")
        res.status(503).json({ error: "Не удалось войти. Попробуйте ещё раз." })
    }
}
