const { pool } = require("../config")

module.exports = (io, socket) => {
    socket.on("friend:request", async data => {
        try {
            const result = await pool.query("SELECT id, username FROM users WHERE username=$1", [data.friendUsername])
            if (result.rows.length === 0) return socket.emit("friend:request:error", { err: "Пользователь не найден" })
            const friendId = result.rows[0].id
            const friendNick = result.rows[0].username
            if (friendNick === socket.user.username) return socket.emit("friend:request:error", { err: "Вы не можете добавить самого себя" })

            const blocked = await pool.query(
                "SELECT 1 FROM friendships WHERE ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND status='blocked'",
                [friendId, socket.user.id]
            )
            if (blocked.rows.length > 0) return socket.emit("friend:request:error", { err: "Пользователь вас заблокировал" })

            const existing = await pool.query(
                "SELECT * FROM friendships WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1) AND status='pending'",
                [socket.user.id, friendId]
            )

            if (existing.rows.length > 0) {
                const row = existing.rows[0]
                if (row.user_id === socket.user.id) {
                    return socket.emit("friend:request:error", { err: `Вы уже отправили запрос в друзья ${friendNick}` })
                } else {
                    return socket.emit("friend:request:error", { err: `${friendNick} уже отправил вам запрос в друзья` })
                }
            }

            await pool.query(
                "INSERT INTO friendships (user_id, friend_id, status, created_at) VALUES ($1, $2, 'pending', NOW()) ON CONFLICT DO NOTHING",
                [socket.user.id, friendId]
            )

            socket.emit("friend:request:success", { msg: "Запрос успешно отправлен", username: data.friendUsername })
            io.to(friendId.toString()).emit("friend:request", {
                id: socket.user.id,
                user_id: socket.user.id,
                friend_id: friendId,
                status: "pending",
                friend_username: socket.user.username
            })
        } catch (err) {
            console.error("friend:request error", err)
        }
    })

    socket.on("friend:accept", async data => {
        try {
            const result = await pool.query("SELECT id FROM users WHERE username=$1", [data.friendUsername])
            if (result.rows.length === 0) return console.error("User not found")
            const friendId = result.rows[0].id

            await pool.query(
                "UPDATE friendships SET status='accepted' WHERE ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND status='pending'",
                [friendId, socket.user.id]
            )

            io.to(friendId.toString()).emit("friend:accept", { from: socket.user })
        } catch (err) {
            console.error("friend:accept error", err)
        }
    })

    socket.on("friend:decline", async data => {
        try {
            const result = await pool.query("SELECT id FROM users WHERE username=$1", [data.friendUsername])
            if (result.rows.length === 0) return console.error("User not found")
            const friendId = result.rows[0].id

            await pool.query(
                "DELETE FROM friendships WHERE ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND status='pending'",
                [friendId, socket.user.id]
            )

            io.to(friendId.toString()).emit("friend:decline", { from: socket.user })
        } catch (err) {
            console.error("friend:decline error", err)
        }
    })

    socket.on("friend:remove", async data => {
        try {
            const result = await pool.query("SELECT id FROM users WHERE username=$1", [data.friendUsername])
            if (result.rows.length === 0) return console.error("User not found")
            const friendId = result.rows[0].id

            await pool.query(
                "DELETE FROM friendships WHERE ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND status='accepted'",
                [socket.user.id, friendId]
            )

            io.to(friendId.toString()).emit("friend:remove", { from: socket.user.username })
        } catch (err) {
            console.error("friend:remove error", err)
        }
    })

    socket.on("friend:block", async data => {
        try {
            const result = await pool.query("SELECT id FROM users WHERE username=$1", [data.friendUsername])
            if (result.rows.length === 0) return console.error("User not found")
            const friendId = result.rows[0].id

            await pool.query(
                "UPDATE friendships SET status='blocked' WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)",
                [socket.user.id, friendId]
            )

            io.to(friendId.toString()).emit("friend:block", { from: socket.user })
        } catch (err) {
            console.error("friend:block error", err)
        }
    })

    socket.on("friend:outgoingList", async (_, callback) => {
        try {
            const result = await pool.query(
                `SELECT u.username 
                FROM friendships f
                JOIN users u ON u.id = f.friend_id
                WHERE f.user_id=$1 AND f.status='pending'`,
                [socket.user.id]
            )

            callback(result.rows.map(r => r.username))
        } catch (err) {
            console.error("friend:outgoingList error", err)
            callback([])
        }
    })

    socket.on("friend:list", async (_, callback) => {
        try {
            const result = await pool.query(
                `SELECT 
                    f.id,
                    f.user_id,
                    f.friend_id,
                    f.status,
                    f.created_at,
                    u.username AS friend_username,
                    CASE 
                        WHEN f.user_id=$1 THEN 'outgoing'
                        ELSE 'incoming'
                    END AS direction
                FROM friendships f
                JOIN users u 
                    ON u.id = CASE WHEN f.user_id=$1 THEN f.friend_id ELSE f.user_id END
                WHERE f.user_id=$1 OR f.friend_id=$1`,
                [socket.user.id]
            )
            callback(result.rows)
        } catch (err) {
            console.error("friend:list error", err)
            callback([])
        }
    })
}