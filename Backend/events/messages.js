const { pool } = require("../config")

module.exports = (io, socket) => {
    socket.on("message:send", async data => {
        try {
            const content = data.message || data.content
            if (!content || content.length > 150) return socket.emit("message:send:error", { err: "Превышена длина сообщения" })

            if (data.roomId) {
                await pool.query(
                    "INSERT INTO messages (sender_id, room_id, content) VALUES ($1, $2, $3)",
                    [socket.user.id, data.roomId, data.content]
                )
                const members = await pool.query("SELECT user_id FROM room_members WHERE room_id=$1", [data.roomId])
                members.rows.forEach(m => {
                    io.to(m.user_id.toString()).emit("message:receive", { roomId: data.roomId, from: socket.user.username, content: data.content, room: true })
                })
                return
            }

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

            const messages = await pool.query(
                "SELECT id FROM messages WHERE (sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1) ORDER BY created_at ASC",
                [socket.user.id, receiverId]
            )
            if (messages.rows.length > 40) {
                const excess = messages.rows.length - 40
                const idsToDelete = messages.rows.slice(0, excess).map(m => m.id)
                await pool.query("DELETE FROM messages WHERE id = ANY($1::int[])", [idsToDelete])
            }

            /*await pool.query(
                `DELETE FROM messages
                WHERE id IN (
                    SELECT id FROM messages
                    WHERE (sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1)
                    ORDER BY created_at ASC
                    LIMIT 1000
                ) AND id NOT IN (
                    SELECT id FROM messages
                    WHERE (sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1)
                    ORDER BY created_at DESC
                    LIMIT 40
                )`,
                [socket.user.id, receiverId]
            )*/

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
            if (data.roomId) {
                const messagesRes = await pool.query(
                    `SELECT 
                        m.id, 
                        m.sender_id,
                        u.username AS sender_username,
                        m.content,
                        m.created_at,
                        m.read,
                        m.sender_id = $1 AS me
                    FROM messages m
                    JOIN users u ON u.id = m.sender_id
                    WHERE m.room_id=$2
                    ORDER BY m.created_at ASC`,
                    [socket.user.id, data.roomId]
                )
                return socket.emit("message:getMessages:success", messagesRes.rows)
            }

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
        } catch {
            socket.emit("message:getMessages:error", { err: "Load error" })
        }
    })
}
