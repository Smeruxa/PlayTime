import { strict as assert } from "node:assert"
import { EventEmitter } from "node:events"
import Module from "node:module"
import { test, mock } from "node:test"
import type { FeatureIo, FeatureRooms, FeatureSocket } from "../../../shared/socket/featureContext"
import type { CallRoomJson } from "./redisService"

let testRooms: Map<string, CallRoomJson>
const redisModulePath = require.resolve("./redisService")
const redisModule = new Module(redisModulePath)
redisModule.exports = {
    callStore: {
        get: async (id: string) => testRooms.get(id) ?? null,
        current: async (id: number) => {
            const found = Array.from(testRooms).find(([, room]) => room.beginer_id === id || room.receiver_id === id)
            return found ? { roomId: found[0], room: found[1] } : {}
        },
        ownership: async (roomId: string, id: number, action: string) => {
            assert.equal(action, "authorize")
            const room = testRooms.get(roomId)
            return room && (room.beginer_id === id || room.receiver_id === id)
                ? { kind: "existing", roomId, room }
                : { kind: "forbidden" }
        }
    }
}
const previousRedisModule = require.cache[redisModulePath]
require.cache[redisModulePath] = redisModule
const { CALL_RECONNECT_TIMEOUT_MS, registerDirectCallRecovery }: typeof import("./recovery") = require("./recovery")
if (previousRedisModule) require.cache[redisModulePath] = previousRedisModule
else delete require.cache[redisModulePath]

const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
}

function setup(indexed = false) {
    const room: CallRoomJson = { beginer_id: 1, receiver_id: 2, status: "in_call", confirmed_at: 1000 }
    const rooms = new Map([["1:2", room]])
    testRooms = rooms
    let online = false
    const endCall = mock.fn(async (roomId: string) => {
        rooms.delete(roomId)
    })
    const services = {
        getRoom: async (id: string) => rooms.get(id) ?? null,
        getAllRooms: async () => Array.from(rooms, ([id, room]) => ({ key: `call:room:${id}`, room })),
        getUserRoom: indexed
            ? async (userId: number) => {
                  const found = Array.from(rooms).find(
                      ([, room]) => room.beginer_id === userId || room.receiver_id === userId
                  )
                  return found ? { key: `call:room:${found[0]}`, room: found[1] } : null
              }
            : undefined,
        roomPrefix: "call:room:",
        endCall
    }
    const connect = (id = 1) => {
        const events = new EventEmitter()
        const target: FeatureRooms = {
            emit: () => true,
            fetchSockets: async () => (online ? [socket] : []),
            disconnectSockets() {},
            socketsLeave() {}
        }
        const io: FeatureIo = { in: () => target, to: () => target, serverSideEmit: () => true }
        const socket: FeatureSocket = {
            id: `socket-${id}`,
            handshake: { auth: {} },
            data: {},
            rooms: new Set(),
            nsp: { in: io.in, server: io },
            to: io.to,
            emit: (event, ...args) => events.emit(event, ...args),
            on(event, handler) {
                events.on(event, handler)
            },
            join() {},
            leave() {}
        }
        registerDirectCallRecovery({ io, socket, user: { id, username: `user${id}` } }, services)
        return socket
    }
    const socket = connect()
    return {
        socket,
        connect,
        rooms,
        room,
        endCall,
        services,
        setOnline: () => {
            online = true
        }
    }
}

test("keeps a call during a VPN switch and cancels expiry on reconnect", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const { socket, connect, rooms, room, endCall } = setup()
    socket.emit("disconnect")
    assert.equal(rooms.get("1:2"), room)
    t.mock.timers.tick(CALL_RECONNECT_TIMEOUT_MS - 1)
    await flush()
    const reconnected = connect()
    const ack = mock.fn()
    reconnected.emit("call:resume", { roomId: "1:2" }, ack)
    await flush()
    assert.deepEqual(ack.mock.calls[0].arguments, [{ success: true, status: "in_call" }])
    t.mock.timers.tick(CALL_RECONNECT_TIMEOUT_MS)
    await flush()
    assert.equal(endCall.mock.callCount(), 0)
    assert.equal(rooms.get("1:2"), room)
})

test("ends an abandoned call after the grace period and reports it on resume", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const { socket, connect, rooms, endCall } = setup()
    rooms.set("3:4", { beginer_id: 3, receiver_id: 4, status: "in_call" })
    socket.emit("disconnect")
    t.mock.timers.tick(CALL_RECONNECT_TIMEOUT_MS)
    await flush()
    assert.equal(endCall.mock.callCount(), 1)
    assert.equal(rooms.has("1:2"), false)
    assert.equal(rooms.has("3:4"), true)
    const ack = mock.fn()
    connect().emit("call:resume", { roomId: "1:2" }, ack)
    await flush()
    assert.deepEqual(ack.mock.calls[0].arguments, [{ ended: true }])
})

test("does not end a call if another socket for the user is still online", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const { socket, setOnline, endCall } = setup()
    setOnline()
    socket.emit("disconnect")
    t.mock.timers.tick(CALL_RECONNECT_TIMEOUT_MS)
    await flush()
    assert.equal(endCall.mock.callCount(), 0)
})

test("a reconnect cancels cleanup even if the timeout is already reading rooms", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const { socket, connect, services, endCall } = setup()
    const getAllRooms = services.getAllRooms
    let resolve!: (rooms: Awaited<ReturnType<typeof getAllRooms>>) => void
    services.getAllRooms = () =>
        new Promise((done) => {
            resolve = done
        })
    socket.emit("disconnect")
    t.mock.timers.tick(CALL_RECONNECT_TIMEOUT_MS)
    await flush()
    connect()
    resolve(await getAllRooms())
    await flush()
    assert.equal(endCall.mock.callCount(), 0)
})

test("resume rejects nonparticipants and detects a hangup missed while offline", async () => {
    const { socket, connect, rooms } = setup()
    const strangerAck = mock.fn()
    connect(3).emit("call:resume", { roomId: "1:2" }, strangerAck)
    await flush()
    assert.deepEqual(strangerAck.mock.calls[0].arguments, [{ err: "You are not part of this call" }])
    rooms.delete("1:2")
    const ack = mock.fn()
    socket.emit("call:resume", { roomId: "1:2" }, ack)
    await flush()
    assert.deepEqual(ack.mock.calls[0].arguments, [{ ended: true }])
})

for (const indexed of [false, true]) {
    test(`an idle disconnect cannot expire a later incoming call (${indexed ? "indexed" : "legacy"} lookup)`, async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 })
        const { socket, rooms, endCall } = setup(indexed)
        rooms.clear()
        socket.emit("disconnect")
        await flush()
        t.mock.timers.tick(CALL_RECONNECT_TIMEOUT_MS - 1000)
        const incoming: CallRoomJson = {
            beginer_id: 2,
            receiver_id: 1,
            status: "request_receiver",
            expires_at: Date.now() + 60_000
        }
        rooms.set("2:1:new", incoming)
        t.mock.timers.tick(1000)
        await flush()
        assert.equal(endCall.mock.callCount(), 0)
        assert.equal(rooms.get("2:1:new"), incoming)
    })
}

test("disconnect cleanup cannot end a replacement call with the same legacy room ID", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 })
    const { socket, rooms, endCall } = setup()
    socket.emit("disconnect")
    await flush()
    t.mock.timers.tick(CALL_RECONNECT_TIMEOUT_MS - 1000)
    const replacement: CallRoomJson = { beginer_id: 1, receiver_id: 2, status: "in_call", confirmed_at: Date.now() }
    rooms.set("1:2", replacement)
    t.mock.timers.tick(1000)
    await flush()
    assert.equal(endCall.mock.callCount(), 0)
    assert.equal(rooms.get("1:2"), replacement)
})

test("delayed disconnect discovery cannot acquire a call created after disconnect", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 })
    const { socket, rooms, services, endCall } = setup()
    rooms.clear()
    let resolve!: (rooms: Awaited<ReturnType<typeof services.getAllRooms>>) => void
    services.getAllRooms = () =>
        new Promise((done) => {
            resolve = done
        })
    socket.emit("disconnect")
    await flush()
    t.mock.timers.tick(CALL_RECONNECT_TIMEOUT_MS - 1000)
    const incoming: CallRoomJson = {
        beginer_id: 2,
        receiver_id: 1,
        status: "request_receiver",
        expires_at: Date.now() + 60_000
    }
    rooms.set("2:1:new", incoming)
    t.mock.timers.tick(1000)
    await flush()
    resolve([{ key: "call:room:2:1:new", room: incoming }])
    await flush()
    assert.equal(endCall.mock.callCount(), 0)
    assert.equal(rooms.get("2:1:new"), incoming)
})

test("indexed recovery still ends the original abandoned active call", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 })
    const { socket, rooms, endCall } = setup(true)
    socket.emit("disconnect")
    await flush()
    t.mock.timers.tick(CALL_RECONNECT_TIMEOUT_MS)
    await flush()
    assert.equal(endCall.mock.callCount(), 1)
    assert.equal(endCall.mock.calls[0].arguments[0], "1:2")
    assert.equal(rooms.has("1:2"), false)
})

test("a captured ringing call can advance to active without escaping abandoned-call cleanup", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 })
    const { socket, rooms, endCall } = setup(true)
    const ringing: CallRoomJson = { beginer_id: 1, receiver_id: 2, status: "request_receiver", expires_at: 150_000 }
    rooms.set("1:2", ringing)
    socket.emit("disconnect")
    await flush()
    t.mock.timers.tick(1000)
    rooms.set("1:2", { ...ringing, status: "in_call", confirmed_at: Date.now() })
    t.mock.timers.tick(CALL_RECONNECT_TIMEOUT_MS - 1000)
    await flush()
    assert.equal(endCall.mock.callCount(), 1)
    assert.equal(rooms.has("1:2"), false)
})

test("reconnect during the final room reread still cancels cleanup", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const { socket, connect, services, room, endCall } = setup(true)
    let resolve!: (room: CallRoomJson | null) => void
    services.getRoom = () =>
        new Promise((done) => {
            resolve = done
        })
    socket.emit("disconnect")
    await flush()
    t.mock.timers.tick(CALL_RECONNECT_TIMEOUT_MS)
    await flush()
    connect()
    resolve(room)
    await flush()
    assert.equal(endCall.mock.callCount(), 0)
})

test("a legacy room without timestamps cannot transfer cleanup ownership to a new ringing call", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 })
    const { socket, rooms, endCall } = setup()
    rooms.set("1:2", { beginer_id: 1, receiver_id: 2, status: "in_call" })
    socket.emit("disconnect")
    await flush()
    t.mock.timers.tick(CALL_RECONNECT_TIMEOUT_MS - 1000)
    const replacement: CallRoomJson = {
        beginer_id: 1,
        receiver_id: 2,
        status: "request_receiver",
        expires_at: Date.now() + 60_000
    }
    rooms.set("1:2", replacement)
    t.mock.timers.tick(1000)
    await flush()
    assert.equal(endCall.mock.callCount(), 0)
    assert.equal(rooms.get("1:2"), replacement)
})

test("a call created before disconnect remains owned when accepted during delayed discovery", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 })
    const { socket, rooms, services, endCall } = setup()
    const ringing: CallRoomJson = { beginer_id: 1, receiver_id: 2, status: "request_receiver", expires_at: 150_000 }
    rooms.set("1:2", ringing)
    let resolve!: (rooms: Awaited<ReturnType<typeof services.getAllRooms>>) => void
    services.getAllRooms = () =>
        new Promise((done) => {
            resolve = done
        })
    socket.emit("disconnect")
    await flush()
    t.mock.timers.tick(1000)
    const accepted: CallRoomJson = { ...ringing, status: "in_call", confirmed_at: Date.now() }
    rooms.set("1:2", accepted)
    resolve([{ key: "call:room:1:2", room: accepted }])
    await flush()
    t.mock.timers.tick(CALL_RECONNECT_TIMEOUT_MS - 1000)
    await flush()
    assert.equal(endCall.mock.callCount(), 1)
    assert.equal(rooms.has("1:2"), false)
})
