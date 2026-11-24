const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const crypto = require("node:crypto")
const ts = require("typescript")

function fixture({ fail = false, env = {} } = {}) {
    let committed = false,
        released = false
    const query = async (sql) => {
        if (sql === "COMMIT") committed = true
        if (sql.includes("SELECT username, is_guest"))
            return {
                rows: [{ username: "old", is_guest: true, guest_registration_pending: false, guest_archived_at: null }]
            }
        if (sql.includes("RETURNING id")) return { rows: [{ id: "session" }] }
        if (sql.includes("AS live")) return { rows: [{ live: false, recent: false }] }
        if (fail && sql.includes("INSERT INTO username_reclaims")) throw new Error("database unavailable")
        return { rows: [] }
    }
    const pool = {
        query,
        connect: async () => ({
            query,
            release() {
                released = true
            }
        })
    }
    const exports = {}
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "../../apps/auth-api/auth/guestLifecycle.ts"), "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true }
        }).outputText,
        { exports, process: { env }, require: (name) => (name === "node:crypto" ? crypto : { pool }) }
    )
    return { lifecycle: exports, committed: () => committed, released: () => released }
}

test("guest archival notifies only after commit and releases the DB client before its sink", async () => {
    const f = fixture()
    const notifications = []
    f.lifecycle.setGuestArchiveListener(async (userId) => {
        assert.equal(f.committed(), true)
        assert.equal(f.released(), true)
        notifications.push(userId)
    })
    await f.lifecycle.revokeGuestDevice(10, "session")
    assert.deepEqual(notifications, [10])
})

test("rolled-back archival never notifies realtime clients", async () => {
    const f = fixture({ fail: true })
    let notified = false
    f.lifecycle.setGuestArchiveListener(() => {
        notified = true
    })
    await assert.rejects(f.lifecycle.revokeGuestDevice(10, "session"), /database unavailable/)
    assert.equal(notified, false)
    assert.equal(f.committed(), false)
    assert.equal(f.released(), true)
})

test("nickname reuse defaults off in production and explicit disable protects identity", async () => {
    const f = fixture()
    assert.equal(f.lifecycle.isGuestNicknameReuseEnabled({ NODE_ENV: "production" }), false)
    assert.equal(
        f.lifecycle.isGuestNicknameReuseEnabled({ NODE_ENV: "production", GUEST_NICKNAME_REUSE_ENABLED: "1" }),
        true
    )
    assert.equal(
        f.lifecycle.isGuestNicknameReuseEnabled({ NODE_ENV: "test", GUEST_NICKNAME_REUSE_ENABLED: "0" }),
        false
    )
    assert.equal(f.lifecycle.isGuestNicknameReuseEnabled({ NODE_ENV: "test" }), true)
})

test("disabled archive performs no identity mutation while device logout still commits", async () => {
    const f = fixture({ env: { NODE_ENV: "production", GUEST_NICKNAME_REUSE_ENABLED: "0" } })
    let notified = false
    f.lifecycle.setGuestArchiveListener(() => {
        notified = true
    })
    const shouldNotQuery = {
        query: async () => {
            throw new Error("disabled archive touched identity")
        }
    }
    assert.equal(await f.lifecycle.archiveGuestIfInactive(shouldNotQuery, 10, "logout"), false)
    await f.lifecycle.revokeGuestDevice(10, "session")
    assert.equal(f.committed(), true)
    assert.equal(notified, false)
})
