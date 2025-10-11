const { pool } = require("../config")

module.exports = (io, socket) => {
    socket.on("message:send", async data => {
        try {
            const result = await pool.query("SELECT id FROM users WHERE username=$1", [data.username])
            if (result.rows.length === 0) return socket.emit("message:send:error", { err: "User not found" })
            const receiverId = result.rows[0].id

            const friend = await pool.query(
                "SELECT 1 FROM friendships WHERE ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND status='accepted'",
                [socket.user.id, receiverId]
            )
            if (friend.rows.length === 0) return socket.emit("message:send:error", { err: "User not a friend" })

            const insert = await pool.query(
                "INSERT INTO messages (sender_id, receiver_id, content, created_at, read) VALUES ($1, $2, $3, NOW(), false) RETURNING id, created_at",
                [socket.user.id, receiverId, data.message]
            )

            const msg = {
                id: insert.rows[0].id,
                sender_username: socket.user.username,
                receiver_username: data.username,
                content: data.message,
                created_at: insert.rows[0].created_at
            }

            io.to(receiverId.toString()).emit("message:receive", msg)
            socket.emit("message:send:success", msg)
        } catch (err) {
            console.log("message:send:error", err)
        }
    })

    socket.on("message:getMessages", async data => {
        try {
            const userRes = await pool.query("SELECT id FROM users WHERE username=$1", [data.username])
            if (userRes.rows.length === 0) return socket.emit("message:getMessages:error", { err: "User not found" })
            const receiverId = userRes.rows[0].id

            const messagesRes = await pool.query(
                `SELECT 
                    m.id, 
                    m.sender_id, 
                    m.receiver_id, 
                    u1.username AS sender_username, 
                    u2.username AS receiver_username, 
                    m.content, 
                    m.created_at, 
                    m.read,
                    m.sender_id = $1 AS me
                FROM messages m
                JOIN users u1 ON u1.id = m.sender_id
                JOIN users u2 ON u2.id = m.receiver_id
                WHERE (m.sender_id=$1 AND m.receiver_id=$2) OR (m.sender_id=$2 AND m.receiver_id=$1)
                ORDER BY m.created_at ASC`,
                [socket.user.id, receiverId]
            )

            socket.emit("message:getMessages:success", messagesRes.rows)
        } catch (err) {
            socket.emit("message:getMessages:error", { err: "Load error" })
            console.log("message:getMessages error", err)
        }
    })
}
