const Redis = require("ioredis")
const redis = new Redis()
const ROOM_PREFIX = "call:room:"

async function saveRoom(roomId, room) {
    const data = typeof room.toJSON === "function" ? room.toJSON() : room;
    await redis.set(`${ROOM_PREFIX}${roomId}`, JSON.stringify(data));
}

async function getRoom(roomId) {
    const data = await redis.get(`${ROOM_PREFIX}${roomId}`)
    return data ? JSON.parse(data) : null
}

async function deleteRoom(roomId) {
    await redis.del(`${ROOM_PREFIX}${roomId}`)
}

async function getAllRooms() {
    const keys = await redis.keys(`${ROOM_PREFIX}*`)
    const rooms = []
    for (const key of keys) {
        const data = await redis.get(key)
        if (data) rooms.push({ key, room: JSON.parse(data) })
    }
    return rooms
}

module.exports = { saveRoom, getRoom, deleteRoom, getAllRooms, ROOM_PREFIX }