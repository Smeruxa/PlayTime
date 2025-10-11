const { pool } = require("../../config")
const Room = require("./room")
const { saveRoom, getRoom, deleteRoom, getAllRooms, ROOM_PREFIX } = require("./redisService")

module.exports = (io, socket) => {
    socket.on("call:start", async (data, callback) => {
        try {
            const result = await pool.query("SELECT id FROM users WHERE username=$1", [data.username])
            if (!result.rows.length) return callback({ err: "User not found" })

            const receiverId = result.rows[0].id
            const allRooms = await getAllRooms()

            const busy = allRooms.some(({ room }) => {
                return (
                    room.beginer_id === socket.user.id ||
                    room.receiver_id === socket.user.id ||
                    room.beginer_id === receiverId ||
                    room.receiver_id === receiverId
                )
            })
            if (busy) return callback({ err: "Один из участников уже в звонке" })

            const room = new Room(socket.user.id, receiverId)
            const roomId = `${socket.user.id}:${receiverId}`
            await saveRoom(roomId, room)

            console.log("incoming send from: ", socket.user.username, "to: ", data.username, receiverId.toString())
            io.to(receiverId.toString()).emit("call:incomingCall", { from: socket.user.username, roomId })
            callback({ success: true, roomId })
        } catch (err) {
            console.log("call:start error", err)
            callback({ err: "Server error" })
        }
    })

    socket.on("call:confirm", async data => {
        try {
            const { roomId, accept } = data
            const room = await getRoom(roomId)
            if (!room) return socket.emit("call:confirm:error", { err: "Room not found" })

            if (accept) {
                room.status = "in_call"
                await saveRoom(roomId, room)

                io.to(room.beginer_id.toString()).emit("call:confirmed", { roomId })
                io.to(room.receiver_id.toString()).emit("call:confirmed", { roomId })
            } else {
                await deleteRoom(roomId)
                io.to(room.beginer_id.toString()).emit("call:rejected", { roomId })
            }
        } catch (err) {
            console.log("call:confirm error", err)
            socket.emit("call:confirm:error", { err: "Server error" })
        }
    })

    socket.on("call:room:broadcast", async data => {
        try {
            const { roomId, voiceData } = data
            const room = await getRoom(roomId)
            if (!room) return socket.emit("call:room:error", { err: "Room not found" })

            let targetId
            if (socket.user.id === room.beginer_id) targetId = room.receiver_id
            else if (socket.user.id === room.receiver_id) targetId = room.beginer_id
            else return socket.emit("call:room:error", { err: "You are not part of this call" })

            io.to(targetId.toString()).emit("call:room:receive", { voiceData })
        } catch (err) {
            console.log("call:room:broadcast error", err)
            socket.emit("call:room:error", { err: "Server error" })
        }
    })

    socket.on("call:end", async data => {
        try {
            const { roomId } = data
            const room = await getRoom(roomId)
            if (!room) return

            await deleteRoom(roomId)
            io.to(room.beginer_id.toString()).emit("call:ended", { roomId })
            io.to(room.receiver_id.toString()).emit("call:ended", { roomId })
        } catch (err) {
            console.log("call:end error", err)
        }
    })

    socket.on("disconnect", async () => {
        try {
            const rooms = await getAllRooms()
            for (const { key, room } of rooms) {
                if (room.beginer_id === socket.user.id || room.receiver_id === socket.user.id) {
                    await deleteRoom(key.replace(ROOM_PREFIX, ""))
                    io.to(room.beginer_id.toString()).emit("call:ended", { roomId: key.replace(ROOM_PREFIX, "") })
                    io.to(room.receiver_id.toString()).emit("call:ended", { roomId: key.replace(ROOM_PREFIX, "") })
                }
            }
        } catch (err) {
            console.log("disconnect error", err)
        }
    })
}