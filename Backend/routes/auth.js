const express = require("express")
const bcrypt = require("bcrypt")
const jwt = require("jsonwebtoken")
const { pool, JWT_SECRET, redis } = require("../config")

const router = express.Router()

const checkLength = (str) => {
    return str.length >= 3 && str.length <= 50
}

router.post("/register", async (req, res) => {
    const { username, email, password } = req.body
    if (!checkLength(username) || !checkLength(password) || !checkLength(email))
        return res.status(400).json({ error: "Поля должны быть от 3 до 50 символов." })
    if (username === "Выберите пользователя" || /[\s\u200B-\u200D\uFEFF]/.test(username))
        return res.status(400).json({ error: "Недопустимый никнейм." })
    if (username.length > 15)
        return res.status(400).json({ error: "Недопустимая длина никнейма." })

    try {
        const ip = req.ip || req.connection.remoteAddress
        const regKey = `register_lock:${ip}`
        const exists = await redis.ttl(regKey)
        if (exists > 0)
            return res.status(429).json({ error: `Регистрация возможна через ${exists} сек.` })

        const hash = await bcrypt.hash(password, 10)
        const result = await pool.query(
            "INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email",
            [username, email, hash]
        )

        await redis.set(regKey, 1, "EX", 60)
        res.json({ user: result.rows[0] })
    } catch {
        res.status(400).json({ error: "Никнейм/почта уже заняты." })
    }
})

router.post("/login", async (req, res) => {
    const { email, password } = req.body
    if (!checkLength(password) || !checkLength(email))
        return res.status(400).json({ error: "Поля должны быть от 3 до 50 символов." })

    try {
        const ip = req.ip || req.connection.remoteAddress
        const key = `login_attempts:${email}:${ip}`
        const blockKey = `blocked:${email}:${ip}`

        const blocked = await redis.ttl(blockKey)
        if (blocked > 0)
            return res.status(429).json({ error: `Аккаунт заблокирован. Повторите через ${blocked} сек.` })

        const result = await pool.query("SELECT * FROM users WHERE email=$1", [email])
        if (result.rows.length === 0) {
            const attempts = await redis.incr(key)
            if (attempts === 1) await redis.expire(key, 3600)
            if (attempts >= 5) {
                await redis.set(blockKey, 1, "EX", 3600)
                await redis.del(key)
                return res.status(429).json({ error: `Аккаунт заблокирован на 1 час` })
            }
            return res.status(400).json({ error: `Пользователь не найден. Осталось ${5 - attempts} попыток` })
        }

        const user = result.rows[0]
        const match = await bcrypt.compare(password, user.password_hash)
        if (!match) {
            const attempts = await redis.incr(key)
            if (attempts === 1) await redis.expire(key, 3600)
            if (attempts >= 5) {
                await redis.set(blockKey, 1, "EX", 3600)
                await redis.del(key)
                return res.status(429).json({ error: `Аккаунт заблокирован на 1 час` })
            }
            return res.status(400).json({ error: `Неверный пароль. Осталось ${5 - attempts} попыток` })
        }

        await redis.del(key)
        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "3d" })
        res.json({ token, user: { id: user.id, username: user.username, email: user.email } })
    } catch {
        res.status(500).json({ error: "Server error" })
    }
})

router.post("/tokenValid", (req, res) => {
    const { token } = req.body
    if (!token) return res.status(400).json({ valid: false, error: "No token provided" })

    try {
        const decoded = jwt.verify(token, JWT_SECRET)
        res.json({
            valid: true,
            user: {
                id: decoded.id,
                username: decoded.username
            }
        })
    } catch (err) {
        res.status(401).json({ valid: false, error: "Invalid or expired token" })
    }
})

module.exports = router