const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { createRequire } = require("node:module")
const ts = require("typescript")
const root = path.resolve(__dirname, "../..")

function deferred() {
    let resolve
    const promise = new Promise((done) => { resolve = done })
    return { promise, resolve }
}

function fixture({ pauseWrap = false, pauseRemoval = false } = {}) {
    const members = new Set([1, 2, 3]), wraps = new Map([[1, 0], [2, 0]])
    const wrapReached = deferred(), continueWrap = deferred(), removalReached = deferred(), continueRemoval = deferred()
    const readerWaiting = deferred(), writerWaiting = deferred()
    const readers = new Set()
    let writer = null, changed = deferred(), clientId = 0
    const statements = []
    const unlock = (id) => {
        readers.delete(id)
        if (writer === id) writer = null
        changed.resolve()
        changed = deferred()
    }
    const roomLock = async (id, exclusive) => {
        while ((writer !== null && writer !== id) || (exclusive && [...readers].some((reader) => reader !== id))) {
            ;(exclusive ? writerWaiting : readerWaiting).resolve()
            await changed.promise
        }
        if (exclusive) writer = id
        else readers.add(id)
    }
    const query = async (id, sql, args = []) => {
        statements.push({ id, sql })
        if (sql === "COMMIT" || sql === "ROLLBACK") { unlock(id); return { rows: [] } }
        if (sql === "BEGIN") return { rows: [] }
        if (sql.startsWith("SELECT key_epoch FROM rooms") && sql.endsWith("FOR UPDATE")) {
            await roomLock(id, true)
            return { rows: [{ key_epoch: 0 }] }
        }
        if (sql.startsWith("SELECT created_by FROM rooms")) {
            if (sql.endsWith("FOR UPDATE")) await roomLock(id, true)
            return { rows: [{ created_by: 1 }] }
        }
        if (sql.startsWith("SELECT 1 FROM room_members")) return { rows: members.has(args[1]) ? [{}] : [] }
        if (sql.startsWith("SELECT user_id FROM room_members")) return { rows: [...members].map((user_id) => ({ user_id })) }
        if (sql.startsWith("SELECT COUNT(*)")) return { rows: [{ c: String(wraps.size) }] }
        if (sql.startsWith("SELECT 1 FROM room_e2ee_wraps")) return { rows: wraps.has(args[1]) ? [{}] : [] }
        if (sql.startsWith("SELECT COALESCE(MAX(id)")) {
            if (pauseWrap) { wrapReached.resolve(); await continueWrap.promise }
            return { rows: [{ mid: 10 }] }
        }
        if (sql.includes("INSERT INTO room_e2ee_wraps")) { wraps.set(args[1], args[4]); return { rows: [] } }
        if (sql.startsWith("DELETE FROM room_members")) {
            const removed = members.delete(args[1])
            return { rows: removed ? [{}] : [], rowCount: removed ? 1 : 0 }
        }
        if (sql.startsWith("DELETE FROM room_e2ee_wraps")) {
            wraps.delete(args[1])
            if (pauseRemoval) { removalReached.resolve(); await continueRemoval.promise }
            return { rows: [] }
        }
        throw new Error("Unexpected isolated query: " + sql)
    }
    const pool = {
        query: (sql, args) => query(0, sql, args),
        connect: async () => {
            const id = ++clientId
            return { query: (sql, args) => query(id, sql, args), release: () => unlock(id) }
        }
    }
    const cache = new Map([
        [path.join(root, "apps/shared/config.ts"), { pool }],
        [path.join(root, "apps/shared/deps.ts"), { pool }],
        [path.join(root, "apps/database/subscriptionPlans.ts"), {}]
    ])
    const load = (file) => {
        if (cache.has(file)) return cache.get(file)
        const module = { exports: {} }, scopedRequire = createRequire(file)
        cache.set(file, module.exports)
        const request = (name) => {
            if (!name.startsWith(".")) return scopedRequire(name)
            const resolved = path.resolve(path.dirname(file), name)
            const target = [resolved, resolved + ".ts", path.join(resolved, "index.ts")].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
            return target.endsWith(".ts") ? load(target) : scopedRequire(name)
        }
        const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
        }).outputText
        vm.runInNewContext(source, { module, exports: module.exports, require: request, console, Buffer }, { filename: file })
        return module.exports
    }
    const emitted = []
    const io = { in: () => ({ fetchSockets: async () => [] }), to: () => ({ emit: (event) => emitted.push(event) }) }
    const register = (file, userId) => {
        const handlers = new Map()
        const socket = { on: (name, handler) => handlers.set(name, handler), leave() {} }
        load(path.join(root, file)).default({ io, socket, user: { id: userId, username: "user" + userId } })
        return handlers
    }
    const keyHandlers = register("apps/chat-api/socket/messages/roomE2eeKeys.ts", 2)
    const envelope = "E2E1:" + JSON.stringify({ n: Buffer.alloc(24).toString("base64"), b: Buffer.alloc(32).toString("base64") })
    const putWrap = async () => {
        let result
        await keyHandlers.get("room:e2eePutWraps")({ roomId: 7, wraps: { 3: envelope } }, (value) => { result = value })
        return result
    }
    const remove = async (leave) => {
        let result
        const handlers = register("apps/chat-api/socket/roomsDb.ts", leave ? 3 : 1)
        await handlers.get(leave ? "room:leaveRoom" : "room:removeMember")({ roomId: 7, userId: 3 }, (value) => { result = value })
        return result
    }
    return { members, wraps, statements, emitted, putWrap, remove, wrapReached, continueWrap, removalReached, continueRemoval, readerWaiting, writerWaiting }
}

test("leaving a room without membership rejects the request without publishing changes", async () => {
    const f = fixture()
    f.members.delete(3)
    assert.equal((await f.remove(true)).err, "Участник не найден")
    assert.deepEqual(f.emitted, [])
    assert.ok(!f.statements.some(({ sql }) => sql.startsWith("DELETE FROM room_e2ee_wraps")))
})

for (const leave of [false, true]) {
    const action = leave ? "leave" : "kick"
    test(`${action} waits for an authorized wrap, then removes membership and the newly written wrap together`, async () => {
        const f = fixture({ pauseWrap: true })
        const writing = f.putWrap()
        await f.wrapReached.promise
        let removed = false
        const removing = f.remove(leave).then((result) => { removed = true; return result })
        await f.writerWaiting.promise
        assert.equal(removed, false)
        f.continueWrap.resolve()
        assert.equal((await writing).success, true)
        assert.equal((await removing).success, true)
        assert.equal(f.members.has(3), false)
        assert.equal(f.wraps.has(3), false)
        f.members.add(3)
        assert.equal(f.wraps.has(3), false, "rejoining must not retain an old history boundary")
        const memberDelete = f.statements.find((entry) => entry.sql.startsWith("DELETE FROM room_members"))
        const wrapDelete = f.statements.find((entry) => entry.sql.startsWith("DELETE FROM room_e2ee_wraps"))
        assert.equal(memberDelete.id, wrapDelete.id)
        assert.ok(f.statements.some((entry) => entry.id === memberDelete.id && entry.sql === "COMMIT"))
    })

    test(`a wrap delayed behind ${action} rechecks membership after the removal commits`, async () => {
        const f = fixture({ pauseRemoval: true })
        const removing = f.remove(leave)
        await f.removalReached.promise
        let written = false
        const writing = f.putWrap().then((result) => { written = true; return result })
        await f.writerWaiting.promise
        assert.equal(written, false)
        f.continueRemoval.resolve()
        assert.equal((await removing).success, true)
        assert.equal((await writing).err, "Некорректный участник")
        assert.equal(f.wraps.has(3), false)
        assert.equal(f.statements.some((entry) => entry.sql.includes("INSERT INTO room_e2ee_wraps")), false)
    })
}
