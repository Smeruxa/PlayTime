const { pool } = require("../config")

module.exports = (io, socket) => {
    socket.on("room:create", async (data, callback) => {
        try {
            if (data.name.length < 3 || data.name.length > 15) 
                return callback({ err: "Название комнаты должно быть от 3 до 15 символов" })
            
            if (data.name === "Выберите пользователя")
                return callback({ err: "Недопустимое название комнаты." })

            const roomRes = await pool.query(
                "INSERT INTO rooms (name, created_by) VALUES ($1, $2) RETURNING id",
                [data.name, socket.user.id]
            )
            const roomId = roomRes.rows[0].id
            await pool.query("INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)", [roomId, socket.user.id])
            callback({ success: true, roomId })
        } catch {
            callback({ err: "Ошибка создания комнаты" })
        }
    })

    socket.on("room:addMember", async (data, callback) => {
        try {
            await pool.query("INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)", [data.roomId, data.userId])
            callback({ success: true })
        } catch {
            callback({ err: "Ошибка добавления" })
        }
    })
}