const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

function fixture() {
    const old = { id: 10, username: "same", guest_archived_at: new Date() }
    const current = { id: 20, username: "same", guest_archived_at: null }
    const calls = []
    const db = {
        async query(sql, args) {
            calls.push({ sql, args })
            if (/WHERE id = \$1/.test(sql)) return { rows: [old, current].filter((p) => p.id === args[0]) }
            assert.match(sql, /NOT EXISTS \(SELECT 1 FROM username_reclaims/)
            return { rows: args[0] === "fresh" ? [{ id: 30, username: "fresh", guest_archived_at: null }] : [] }
        }
    }
    const exports = {}
    const source = fs.readFileSync(path.resolve(__dirname, "../../apps/chat-api/socket/peerIdentity.ts"), "utf8")
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
        exports,
        require: () => ({ pool: db })
    })
    return { resolve: exports.resolvePeer, emit: exports.emitPeerEvent, calls }
}

test("reused nickname never routes archived conversation to its new owner", async () => {
    const { resolve, calls } = fixture()
    assert.equal((await resolve(10, "same", { allowArchived: true })).id, 10)
    assert.equal(await resolve(10, "same"), null)
    assert.equal(await resolve(undefined, "same", { allowArchived: true }), null)
    assert.equal((await resolve(20, "same")).id, 20)
    assert.equal((await resolve(undefined, "fresh")).id, 30)
    assert.equal(calls.filter((c) => c.args[0] === 10).length, 2)
})

test("malformed supplied stable IDs fail without any username fallback query", async () => {
    const { resolve, calls } = fixture()
    for (const id of [null, "20", 0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, {}]) {
        assert.equal(await resolve(id, "same"), null)
    }
    assert.equal(calls.length, 0)
})

test("typing socket handler targets stable owner and fails closed for old or legacy context", async () => {
    const handlers = new Map()
    const deliveries = []
    const peers = [
        { id: 10, username: "same", guest_archived_at: new Date() },
        { id: 20, username: "same", guest_archived_at: null }
    ]
    const db = {
        async query(sql, args) {
            if (sql.includes("FROM friendships")) return { rows: [{ accepted: true }] }
            if (sql.includes("WHERE id = $1")) return { rows: peers.filter((p) => p.id === args[0]) }
            assert.match(sql, /username_reclaims/)
            return { rows: [] }
        }
    }
    function load(relative, dependencies) {
        const exports = {}
        const source = fs.readFileSync(path.resolve(__dirname, relative), "utf8")
        vm.runInNewContext(
            ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
            { exports, require: (name) => dependencies[name], console }
        )
        return exports
    }
    const identity = load("../../apps/chat-api/socket/peerIdentity.ts", { "../../shared/deps": { pool: db } })
    const typing = load("../../apps/chat-api/socket/messages/typing.ts", {
        "../peerIdentity": identity,
        "./helpers": {
            pool: db,
            normalizeUsername: (raw) => (typeof raw === "string" ? raw : ""),
            parsePositiveInt: Number
        }
    })
    typing.default({
        socket: { on: (event, handler) => handlers.set(event, handler) },
        user: { id: 1, username: "reader" },
        io: { to: (target) => ({ emit: (event, data) => deliveries.push({ target, event, data }) }) }
    })
    const handler = handlers.get("chat:typing")
    await handler({ peerUserId: 10, dmUsername: "same", typing: false })
    await handler({ dmUsername: "same", typing: false })
    await handler({ peerUserId: "20", dmUsername: "same", typing: false })
    assert.equal(deliveries.length, 0)
    await handler({ peerUserId: 20, dmUsername: "same", typing: false })
    assert.equal(deliveries.length, 1)
    assert.equal(deliveries[0].target, "20")
    assert.equal(deliveries[0].data.fromUserId, 1)
})

test("HTTP block/report/unblock use stable peer IDs and never fall back after reuse", async () => {
    const routes = []
    const writes = []
    const old = { id: 10, username: "same", guest_archived_at: new Date() }
    const db = {
        async query(sql, args) {
            if (sql.includes("FROM users WHERE id = $1")) return { rows: args[0] === 10 ? [old] : [] }
            if (sql.includes("username_reclaims")) return { rows: [] }
            writes.push({ sql, args })
            return { rows: [] }
        }
    }
    const load = (relative, dependencies) => {
        const exports = {}
        vm.runInNewContext(
            ts.transpileModule(fs.readFileSync(path.resolve(__dirname, relative), "utf8"), {
                compilerOptions: { module: ts.ModuleKind.CommonJS }
            }).outputText,
            { exports, require: (name) => dependencies[name], console }
        )
        return exports
    }
    const identity = load("../../apps/chat-api/socket/peerIdentity.ts", { "../../shared/deps": { pool: db } })
    load("../../apps/chat-api/routes/peerSafety.ts", {
        "../socket/peerIdentity": identity,
        express: {
            default: { Router: () => ({ use() {}, get() {}, post: (path, handler) => routes.push({ path, handler }) }) }
        },
        "../../shared/config": { pool: db, redis: { incr: async () => 2 } },
        "../../shared/http/bearerAuth": {},
        "../../gateway/middlewares/adminSessionMiddleware": {},
        "../../gateway/middlewares/adminWriteMiddleware": {},
        "../../gateway/admin/adminAuditLog": {},
        "../services/peerBlock": { blockPeer: async (_, user, peer) => writes.push({ blockedId: peer.id }) }
    })
    const handler = routes.find((route) => route.path === "/:username/:action").handler
    let status = 200
    const res = {
        status(code) {
            status = code
            return this
        },
        json(body) {
            return body
        }
    }
    const req = (action) => ({
        userId: 1,
        username: "reader",
        params: { username: "same", action },
        body: {},
        app: { get() {}, locals: { peerBlockEffects: {} } }
    })
    for (const action of ["block", "unblock", "report"]) {
        status = 200
        await handler(req(action), res)
        assert.equal(status, 400)
    }
    assert.equal(writes.length, 0)
    const block = req("block")
    block.body.peerUserId = 10
    await handler(block, res)
    assert.equal(writes[0].blockedId, 10)
    const malformed = req("block")
    malformed.body.peerUserId = "20"
    await handler(malformed, res)
    assert.equal(writes.length, 1)
})

test("guest and reclaimed-name live events reach capable sockets and exclude legacy sockets", async () => {
    const received = []
    const sockets = [
        { name: "legacy", rooms: ["1"] },
        { name: "modern", rooms: ["1", "peer-identity-v1:1"] }
    ]
    const exports = {}
    const db = {
        query: async (sql) => {
            assert.match(sql, /u.is_guest = TRUE OR u.guest_archived_at IS NOT NULL OR EXISTS/)
            return { rows: [{ guestOrReclaimed: true }] }
        }
    }
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "../../apps/chat-api/socket/peerIdentity.ts"), "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS }
        }).outputText,
        {
            exports,
            require: (name) =>
                name === "../../shared/socket/peerAudience"
                    ? require("../../apps/shared/socket/peerAudience.ts")
                    : { pool: db }
        }
    )
    const io = {
        to: (room) => ({
            emit: (event, data) => {
                for (const socket of sockets)
                    if (socket.rooms.includes(room)) received.push({ socket: socket.name, event, data })
            }
        })
    }
    await exports.emitPeerEvent(io, 1, [1, 20], "message:receive", { sender_id: 20 })
    assert.equal(received.length, 1)
    assert.equal(received[0].socket, "modern")
    assert.equal(received[0].data.sender_id, 20)
})

test("room invitations reject reclaimed names and malformed IDs before checking membership", async () => {
    const handlers = new Map()
    const queries = []
    const db = {
        async query(sql, args) {
            queries.push({ sql, args })
            if (sql.includes("WHERE id = $1"))
                return { rows: args[0] === 20 ? [{ id: 20, username: "same", guest_archived_at: null }] : [] }
            return { rows: [] }
        }
    }
    const load = (relative, deps) => {
        const exports = {}
        vm.runInNewContext(
            ts.transpileModule(fs.readFileSync(path.resolve(__dirname, relative), "utf8"), {
                compilerOptions: { module: ts.ModuleKind.CommonJS }
            }).outputText,
            { exports, require: (name) => deps[name], console }
        )
        return exports
    }
    const identity = load("../../apps/chat-api/socket/peerIdentity.ts", { "../../shared/deps": { pool: db } })
    const shared = {
        "../../../shared/deps": { pool: db },
        "../../../shared/types/socket/ack": { socketAck: (fn) => fn },
        "../../../shared/socket/parseRoomId": {
            parseRoomIdField: (value) => (Number.isSafeInteger(value) && value > 0 ? value : 0)
        }
    }
    const views = load("../../apps/chat-api/socket/rooms/views.ts", shared)
    const invites = load("../../apps/chat-api/socket/rooms/invites.ts", {
        ...shared,
        "../peerIdentity": identity,
        "../../../database/subscriptionPlans": {},
        "./membership": {},
        "./transaction": {},
        "./views": views
    })
    invites.registerRoomInvites({ socket: { on: (event, fn) => handlers.set(event, fn) }, io: {}, user: { id: 1 } })
    const add = handlers.get("room:addMember")
    for (const payload of [
        { username: "same" },
        { userId: "20", username: "same" },
        { peerUserId: null, userId: 20, username: "same" }
    ]) {
        let response
        await add({ roomId: 5, ...payload }, (result) => {
            response = result
        })
        assert.equal(response.err, "Пользователь не найден")
    }
    assert.equal(
        queries.some((q) => q.sql.includes("FROM room_members")),
        false
    )
    await add({ roomId: 5, userId: 20, username: "stale" }, () => {})
    assert.equal(queries.find((q) => q.sql.includes("WHERE id = $1")).args[0], 20)
    assert.equal(
        queries.some((q) => q.sql.includes("FROM room_members")),
        true
    )
})
