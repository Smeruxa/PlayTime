const express = require("express")
const bcrypt = require("bcrypt")
const jwt = require("jsonwebtoken")
const { pool, JWT_SECRET } = require("../config")

const router = express.Router()

router.post("/register", async (req, res) => {
    const { username, email, password } = req.body
    try {
        const hash = await bcrypt.hash(password, 10)
        const result = await pool.query(
            "INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email",
            [username, email, hash]
        )
        res.json({ user: result.rows[0] })
    } catch (err) {
        console.error(err)
        res.status(400).json({ error: "Никнейм/почта уже заняты." })
    }
})

router.post("/login", async (req, res) => {
    const { email, password } = req.body
    try {
        const result = await pool.query("SELECT * FROM users WHERE email=$1", [email])
        if (result.rows.length === 0) return res.status(400).json({ error: "Пользователь не найден" })

        const user = result.rows[0]
        const match = await bcrypt.compare(password, user.password_hash)
        if (!match) return res.status(400).json({ error: "Неверный пароль" })

        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "3d" })
        res.json({ token, user: { id: user.id, username: user.username, email: user.email } })
    } catch (err) {
        console.error(err)
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