const { pool } = require("../config")
const bcrypt = require("bcrypt")

module.exports = (io, socket) => {
    socket.on("user:changePassword", async (data, callback) => {
        try {
            if (!data.newPassword || data.newPassword.length < 3 || data.newPassword.length > 30) {
                return callback({ success: false, err: "Пароль должен быть от 3 до 30 символов" })
            }
            const hashedPassword = await bcrypt.hash(data.newPassword, 10)
            await pool.query(
                "UPDATE users SET password_hash=$1 WHERE id=$2",
                [hashedPassword, socket.user.id]
            )
            callback({ success: true })
        } catch (err) {
            console.error("user:changePassword:error", err)
            callback({ success: false, err: "Ошибка при изменении пароля" })
        }
    })
}