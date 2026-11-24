const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { createRequire } = require("node:module")
const ts = require("typescript")
const root = path.resolve(__dirname, "../..")

function modules(replacements) {
    const cache = new Map(Object.entries(replacements).map(([name, value]) => [path.join(root, name), value]))
    const load = (name) => {
        const file = path.isAbsolute(name) ? name : path.join(root, name)
        if (cache.has(file)) return cache.get(file)
        const module = { exports: {} }
        cache.set(file, module.exports)
        const scopedRequire = createRequire(file)
        const request = (name) => {
            if (!name.startsWith(".")) return scopedRequire(name)
            const resolved = path.resolve(path.dirname(file), name)
            const target = [resolved, resolved + ".ts", path.join(resolved, "index.ts")].find(
                (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()
            )
            return target.endsWith(".ts") ? load(target) : scopedRequire(name)
        }
        const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
        }).outputText
        vm.runInNewContext(
            source,
            {
                module,
                exports: module.exports,
                require: request,
                console,
                Buffer,
                process,
                setTimeout,
                clearTimeout,
                setImmediate
            },
            { filename: file }
        )
        return module.exports
    }
    return load
}

function fixture() {
    const state = {
        blocked: false,
        friend: true,
        call: { beginer_id: 1, receiver_id: 2, status: "in_call", revision: 2 },
        failCleanup: false
    }
    const events = [],
        statements = [],
        clearedTimers = []
    const query = async (sql) => {
        statements.push(sql)
        if (sql.startsWith("SELECT id,") && sql.includes("guest_archived_at") && sql.includes("FROM users"))
            return { rows: [{ id: 2, username: "bob", guest_archived_at: null }] }
        if (sql.startsWith("SELECT id FROM users")) return { rows: [{ id: 2 }] }
        if (sql.startsWith("SELECT 1 FROM user_blocks")) return { rows: state.blocked ? [{}] : [] }
        if (sql.startsWith("SELECT 1 FROM friendships")) return { rows: state.friend && !state.blocked ? [{}] : [] }
        if (sql.startsWith("SELECT id, username"))
            return {
                rows: [
                    { id: 1, username: "alice" },
                    { id: 2, username: "bob" }
                ]
            }
        if (sql.startsWith("INSERT INTO user_blocks")) state.blocked = true
        if (sql.startsWith("DELETE FROM friendships")) state.friend = false
        return { rows: [] }
    }
    const pool = { query, connect: async () => ({ query, release() {} }) }
    const callStore = {
        get: async () => state.call,
        current: async () => {
            if (state.failCleanup) throw new Error("isolated Redis failure")
            return state.call ? { roomId: "1:2:test", room: state.call } : {}
        },
        transition: async (_id, _uid, action) => {
            assert.equal(action, "end")
            if (!state.call) return { kind: "missing" }
            const room = state.call
            state.call = null
            return { kind: "ended", room }
        },
        ownership: async () =>
            state.call ? { kind: "existing", roomId: "1:2:test", room: state.call } : { kind: "missing" },
        reserve: async () => ({ kind: "created", roomId: "1:2:test", room: state.call })
    }
    const redisService = {
        callStore,
        getRoom: async () => state.call,
        getAllRooms: async () => [],
        ROOM_PREFIX: "call:room:"
    }
    const io = {
        to: (target) => ({ emit: (event, payload) => events.push({ target, event, payload }) }),
        in: () => ({ fetchSockets: async () => [] })
    }
    const load = modules({
        "apps/shared/config.ts": { pool, redis: { incr: async () => 1, expire: async () => {} } },
        "apps/shared/deps.ts": { pool },
        "apps/shared/redis.ts": { redis: { set: async () => "OK" } },
        "apps/gateway/presence.ts": { invalidatePresenceFriends() {} },
        "apps/room-api/socket/directCall/redisService.ts": redisService,
        "apps/room-api/socket/directCall/ringTimeout.ts": {
            clearCallRingTimeout: (id) => clearedTimers.push(id),
            scheduleCallRingTimeout() {}
        },
        "apps/room-api/socket/directCall/recovery.ts": { registerDirectCallRecovery() {} },
        "apps/gateway/legacy/callLog.ts": { logDirectCallDuration: async () => {} },
        "apps/gateway/subscription/subscriptionService.ts": {
            getLimitsForUser: async () => ({ limits: { maxScreenBroadcastFps: 10 } })
        },
        "apps/room-api/media/iceServers.ts": { getIceServers: () => [] },
        "apps/shared/http/bearerAuth.ts": { bearerAuthMiddleware() {} },
        "apps/gateway/middlewares/adminSessionMiddleware.ts": { adminSessionMiddleware() {} },
        "apps/gateway/middlewares/adminIpWhitelistMiddleware.ts": { adminIpWhitelistMiddleware() {} },
        "apps/gateway/middlewares/adminWriteMiddleware.ts": { adminWriteMiddleware() {} },
        "apps/gateway/admin/adminAuditLog.ts": { logAdminAction: async () => {} }
    })
    const effects = load("apps/gateway/legacy/peerBlockEffects.ts").createLegacyPeerBlockEffects(() => io)
    const register = (file, id = 1, dependencies = effects) => {
        const handlers = new Map()
        const socket = {
            id: "legacy-test-socket",
            data: {},
            handshake: { auth: {} },
            on: (event, handler) => handlers.set(event, handler),
            emit() {},
            rooms: new Set()
        }
        load(file).default({ io, socket, user: { id, username: id === 1 ? "alice" : "bob" } }, dependencies)
        return handlers
    }
    const blockHttp = async () => {
        const router = load("apps/chat-api/routes/peerSafety.ts").default
        const handler = router.stack.find((layer) => layer.route?.path === "/:username/:action").route.stack[0].handle
        const response = {
            statusCode: 200,
            status(code) {
                this.statusCode = code
                return this
            },
            json(body) {
                this.body = body
                return this
            }
        }
        await handler(
            {
                params: { username: "bob", action: "block" },
                userId: 1,
                username: "alice",
                app: { get: () => io, locals: { peerBlockEffects: effects } }
            },
            response
        )
        return response
    }
    return { state, events, statements, clearedTimers, callStore, load, register, blockHttp }
}

test("legacy socket block ends the call on every device and repeated blocks do not repeat call:ended", async () => {
    const f = fixture()
    const handlers = f.register("apps/chat-api/socket/friendship.ts")
    await handlers.get("friend:block")({ friendUsername: "bob" })
    assert.equal(f.state.blocked, true)
    assert.equal(f.state.friend, false)
    assert.equal(f.state.call, null)
    assert.deepEqual(
        f.events
            .filter((event) => event.event === "call:ended")
            .map((event) => event.target)
            .sort(),
        ["1", "2"]
    )
    assert.deepEqual(f.clearedTimers, ["1:2:test"])
    await handlers.get("friend:block")({ friendUsername: "bob" })
    assert.equal(f.events.filter((event) => event.event === "call:ended").length, 2)
    assert.equal(f.statements.filter((sql) => sql === "COMMIT").length, 2)
})

test("HTTP block shares call cleanup and does not claim success if cleanup fails", async () => {
    const f = fixture()
    assert.equal((await f.blockHttp()).statusCode, 200)
    assert.equal(f.state.call, null)
    assert.equal(f.events.filter((event) => event.event === "call:ended").length, 2)
    const failed = fixture()
    failed.state.failCleanup = true
    assert.equal((await failed.blockHttp()).statusCode, 503)
    assert.equal(failed.state.blocked, true)
    assert.equal(failed.state.friend, false)
    assert.equal(
        failed.events.some((event) => event.event === "call:ended"),
        false
    )
})

test("blocking a peer does not end an unrelated call", async () => {
    const f = fixture()
    f.state.call = { beginer_id: 1, receiver_id: 3, status: "in_call" }
    await f.blockHttp()
    assert.equal(f.state.call.receiver_id, 3)
    assert.equal(
        f.events.some((event) => event.event === "call:ended"),
        false
    )
})

test("blocked peers cannot relay direct offers, answers, ICE or screen state through a surviving call", async () => {
    const f = fixture()
    const { arePeersBlocked } = f.load("apps/chat-api/services/peerBlock.ts")
    const handlers = f.register("apps/room-api/socket/webrtc/signaling.ts", 2, arePeersBlocked)
    const signal = { context: "direct", roomId: "1:2:test", targetUserId: 1 }
    await handlers.get("webrtc:signal")({ ...signal, type: "offer", payload: { sdp: "v=0" } })
    assert.equal(f.events.filter((event) => event.event === "webrtc:signal").length, 1)
    f.state.blocked = true
    for (const type of ["offer", "answer", "ice"]) {
        await handlers.get("webrtc:signal")({
            ...signal,
            type,
            payload: type === "ice" ? { candidate: "candidate:test" } : { sdp: "v=0" }
        })
    }
    await handlers.get("webrtc:screen:state")({ context: "direct", roomId: "1:2:test", active: true })
    assert.equal(f.events.filter((event) => event.event === "webrtc:signal").length, 1)
    assert.equal(
        f.events.some((event) => event.event === "webrtc:screen:state"),
        false
    )
})

test("a block committed during call reservation ends the reservation without ringing the blocked peer", async () => {
    const f = fixture()
    f.state.call = null
    f.callStore.reserve = async () => {
        f.state.blocked = true
        f.state.friend = false
        f.state.call = { beginer_id: 1, receiver_id: 2, status: "request_receiver", revision: 1 }
        return { kind: "created", roomId: "1:2:test", room: f.state.call }
    }
    const { localDirectCallServices } = f.load("apps/gateway/legacy/directCallServices.ts")
    const handlers = f.register("apps/room-api/socket/directCall/index.ts", 1, localDirectCallServices)
    let response
    await handlers.get("call:start")({ username: "bob" }, (value) => {
        response = value
    })
    assert.ok(response.err)
    assert.equal(f.state.call, null)
    assert.equal(
        f.events.some((event) => ["call:incomingCall", "call:state", "call:confirmed"].includes(event.event)),
        false
    )
})
