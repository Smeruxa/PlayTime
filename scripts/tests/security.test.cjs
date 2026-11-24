const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const vm = require("node:vm")
const http = require("node:http")
const { createRequire } = require("node:module")
const { EventEmitter, once } = require("node:events")
const ts = require("typescript")
const root = path.resolve(__dirname, "../..")
const backendRequire = createRequire(path.join(root, "apps/package.json"))
const jwt = backendRequire("jsonwebtoken")
const { Server } = backendRequire("socket.io")
const { io: connectClient } = require("socket.io-client")

function modules(config = {}, replacements = {}, globals = {}) {
    const cache = new Map([
        [path.join(root, "apps/shared/config.ts"), config],
        [path.join(root, "apps/shared/redis.ts"), { redis: config.redis }]
    ])
    for (const [name, value] of Object.entries(replacements)) cache.set(path.join(root, name), value)
    const load = (name) => {
        const file = path.isAbsolute(name) ? name : path.join(root, name)
        if (cache.has(file)) return cache.get(file)
        const module = { exports: {} }
        cache.set(file, module.exports)
        const scopedRequire = createRequire(file)
        const request = (name) => {
            if (!name.startsWith(".")) return scopedRequire(name)
            let resolved = path.resolve(path.dirname(file), name)
            for (const candidate of [resolved, resolved + ".ts", path.join(resolved, "index.ts")]) {
                if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                    resolved = candidate
                    break
                }
            }
            return resolved.endsWith(".ts") ? load(resolved) : scopedRequire(name)
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
                process,
                Buffer,
                TextEncoder,
                console,
                Uint8Array,
                Blob,
                URL,
                Date,
                setTimeout,
                clearTimeout,
                setImmediate,
                setInterval,
                clearInterval,
                ...globals
            },
            { filename: file }
        )
        cache.set(file, module.exports)
        return module.exports
    }
    return load
}
function redisFixture() {
    const values = new Map(),
        sets = new Map()
    return {
        values,
        get: async (key) => values.get(key) ?? null,
        set: async (key, value) => {
            values.set(key, String(value))
            return "OK"
        },
        incr: async (key) => {
            const value = Number(values.get(key) || 0) + 1
            values.set(key, String(value))
            return value
        },
        exists: async (key) => Number(values.has(key)),
        ttl: async () => -2,
        expire: async () => 1,
        del: async (...keys) => {
            for (const key of keys) {
                values.delete(key)
                sets.delete(key)
            }
        },
        sadd: async (key, member) => {
            if (!sets.has(key)) sets.set(key, new Set())
            sets.get(key).add(member)
        },
        srem: async (key, member) => sets.get(key)?.delete(member),
        smembers: async (key) => Array.from(sets.get(key) || []),
        eval: async (_script, _count, key) => {
            const value = values.get(key)
            values.delete(key)
            return value ?? null
        }
    }
}
const key = "11111111-1111-4111-8111-111111111111"
const otherKey = "22222222-2222-4222-8222-222222222222"
const waitFor = async (predicate) => {
    for (let n = 0; n < 100; n++) {
        if (predicate()) return
        await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.fail("condition was not reached")
}

test("media round-trips with its encrypted descriptor and rejects tampering or a wrong key", async () => {
    const crypto = modules()("apps/frontend/src/features/chat/mediaEncryption.ts")
    const plain = new Blob(["private voice/file bytes"], { type: "text/plain" })
    const encrypted = await crypto.encryptMedia(plain)
    const descriptor = {
        kind: "attachment",
        storageKey: key,
        key: encrypted.key,
        nonce: encrypted.nonce,
        mime: "text/plain",
        filename: "private.txt",
        sizeBytes: plain.size
    }
    const decoded = crypto.decodeMediaMessage(crypto.encodeMediaMessage(descriptor))
    assert.equal(decoded.storageKey, key)
    assert.equal(encrypted.blob.type, "application/octet-stream")
    assert.equal((await encrypted.blob.text()).includes("private"), false)
    const opened = await crypto.mediaBlobForPlayback(encrypted.blob, "application/octet-stream", decoded)
    assert.equal(await opened.text(), await plain.text())
    const corrupted = new Uint8Array(await encrypted.blob.arrayBuffer())
    corrupted[0] ^= 1
    await assert.rejects(crypto.mediaBlobForPlayback(new Blob([corrupted]), "text/plain", decoded))
    await assert.rejects(
        crypto.mediaBlobForPlayback(encrypted.blob, "text/plain", {
            ...decoded,
            key: Buffer.alloc(32).toString("base64")
        })
    )
    await assert.rejects(crypto.mediaBlobForPlayback(encrypted.blob, "text/plain", { ...decoded, sizeBytes: 1 }))
    assert.equal(crypto.decodeMediaMessage(crypto.encodeMediaMessage({ ...descriptor, nonce: "bad" })), null)
})

test("Android AAC voice keeps its audio MIME after encrypted descriptor playback", async () => {
    const crypto = modules()("apps/frontend/src/features/chat/mediaEncryption.ts")
    const plain = new Blob([Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 77, 52, 65, 32])], { type: "audio/mp4" })
    const encrypted = await crypto.encryptMedia(plain)
    const descriptor = crypto.decodeMediaMessage(crypto.encodeMediaMessage({
        kind: "voice", storageKey: key, key: encrypted.key, nonce: encrypted.nonce,
        mime: "audio/mp4; codecs=mp4a.40.2", filename: "voice.m4a", sizeBytes: plain.size, durationSec: 2.4
    }))
    assert.ok(descriptor)
    assert.equal(descriptor.mime, "audio/mp4")
    const playback = await crypto.mediaBlobForPlayback(encrypted.blob, "application/octet-stream", descriptor)
    assert.equal(playback.type, "audio/mp4")
    assert.deepEqual(new Uint8Array(await playback.arrayBuffer()), new Uint8Array(await plain.arrayBuffer()))
    assert.equal(crypto.safeMediaMime("text/html"), "application/octet-stream")
    assert.equal(crypto.isPreviewImage("audio/mp4"), false)
})

test("SVG and disguised images cannot become active preview blobs; legacy media stays readable", async () => {
    const crypto = modules()("apps/frontend/src/features/chat/mediaEncryption.ts")
    const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'])
    assert.equal(crypto.isPreviewImage("image/svg+xml"), false)
    assert.equal((await crypto.mediaBlobForPlayback(svg, "image/svg+xml")).type, "application/octet-stream")
    assert.equal((await crypto.mediaBlobForPlayback(svg, "image/png")).type, "application/octet-stream")
    assert.equal(
        (await crypto.mediaBlobForPlayback(new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])]), "image/png"))
            .type,
        "image/png"
    )
    assert.equal((await crypto.mediaBlobForPlayback(new Blob(["old voice"]), "audio/webm")).type, "audio/webm")
})

test("Electron blocks active blob/file windows and sends only validated HTTP links to the browser", () => {
    const { externalUrl, protectNavigation } = require("../../apps/frontend/public/electron/navigation-security")
    const opened = [],
        handlers = new Map()
    let popup
    protectNavigation(
        {
            setWindowOpenHandler: (fn) => {
                popup = fn
            },
            on: (name, fn) => handlers.set(name, fn)
        },
        (url) => opened.push(url)
    )
    for (const url of [
        "blob:file:///attack",
        "file:///tmp/attack.svg",
        "javascript:alert(1)",
        "https://name:password@example.com"
    ]) {
        assert.equal(externalUrl(url), null)
        assert.equal(popup({ url }).action, "deny")
    }
    assert.equal(opened.length, 0)
    assert.equal(popup({ url: "https://example.com/chat" }).action, "deny")
    assert.deepEqual(opened, ["https://example.com/chat"])
    let prevented = false
    handlers.get("will-navigate")(
        {
            preventDefault: () => {
                prevented = true
            }
        },
        "blob:file:///attack"
    )
    assert.equal(prevented, true)
    assert.equal(opened.length, 1)
})

test("a kick removes all devices from the voice room and tells the other peers to close WebRTC", async () => {
    const { revokeRoomAccess } = modules()("apps/chat-api/socket/revokeRoomAccess.ts")
    const sockets = [new Set(["room:7", "room:8"]), new Set(["room:7"])]
    const events = []
    const io = {
        in: (user) => {
            assert.equal(user, "2")
            return { fetchSockets: async () => sockets.map((rooms) => ({ leave: async (room) => rooms.delete(room) })) }
        },
        to: (room) => ({ emit: (event, payload) => events.push({ room, event, payload }) })
    }
    await revokeRoomAccess(io, 7, 2)
    assert.equal(
        sockets.some((rooms) => rooms.has("room:7")),
        false
    )
    assert.equal(sockets[0].has("room:8"), true)
    assert.equal(events.find((event) => event.room === "room:7").event, "party:participant:left")
    assert.equal(events.find((event) => event.room === "2").event, "room:removed")
})

test("party audio handlers drop forged binary objects and relay only normalized bytes", async () => {
    const register = modules({}, {
        "apps/room-api/media/voiceDenoise.ts": { maybeDenoiseVoicePayload: async data => data },
        "apps/gateway/subscription/subscriptionService.ts": {}
    })("apps/room-api/socket/party/partyMedia.ts").default
    const handlers = new Map()
    const received = []
    const socket = {
        id: "audio-sender",
        rooms: new Set(["room:7"]),
        on: (event, handler) => handlers.set(event, handler),
        to: () => ({ emit: (event, data) => received.push({ event, data }) })
    }
    register({ socket, user: { id: 1, username: "sender" } }, async () => null)
    for (const event of ["party:voice:broadcast", "party:screen:audio:broadcast"]) {
        await handlers.get(event)({ roomId: 7, voiceData: { length: 1, padding: "untrusted" } })
        assert.equal(received.length, 0)
    }
    for (const event of ["party:voice:broadcast", "party:screen:audio:broadcast"]) {
        const voiceData = Buffer.from([1, 2, 3])
        voiceData.padding = "untrusted"
        await handlers.get(event)({ roomId: 7, voiceData })
        const forwarded = received.pop().data.voiceData
        assert(Buffer.isBuffer(forwarded))
        assert.deepEqual([...forwarded], [1, 2, 3])
        assert.equal(forwarded.padding, undefined)
    }
})

function storageFixture(guests = []) {
    const objects = new Map()
    let locked = Promise.resolve()
    const query = async (sql, args = []) => {
        if (sql.startsWith("SELECT tier.quota_group")) {
            const rows = Array.from(objects.values())
            const quotaGroup = guests.includes(args[0]) ? "guest" : args[1]
            const owned = rows.filter((o) => o.uid === args[0])
            return {
                rows: [
                    {
                        quota_group: quotaGroup,
                        total_size: rows.reduce((s, o) => s + o.size, 0),
                        group_size: rows.filter((o) => o.group === quotaGroup).reduce((s, o) => s + o.size, 0),
                        owner_size: owned.reduce((s, o) => s + o.size, 0),
                        attachments: owned.filter((o) => o.kind === "attachment").length,
                        voices: owned.filter((o) => o.kind === "voice").length
                    }
                ]
            }
        }
        if (sql.startsWith("INSERT INTO media_objects")) {
            objects.set(args[0], { uid: args[1], kind: args[2], size: args[3], group: args[4] })
            return { rows: [] }
        }
        if (sql.startsWith("DELETE FROM media_objects")) {
            objects.delete(args[0])
            return { rows: [] }
        }
        if (sql.startsWith("DELETE FROM attachment_staging") || sql.startsWith("DELETE FROM voice_staging"))
            return { rows: [] }
        if (sql.startsWith("SELECT storage_key, kind, finalized_at")) return { rows: [] }
        if (sql.startsWith("SELECT storage_key, kind"))
            return { rows: Array.from(objects, ([storage_key, o]) => ({ storage_key, ...o })).filter((o) => o.expired) }
        if (sql.startsWith("SELECT storage_key FROM"))
            return { rows: Array.from(objects.keys(), (storage_key) => ({ storage_key })) }
        throw Error("Unexpected storage query: " + sql)
    }
    const pool = {
        query,
        connect: async () => {
            let release
            return {
                release() {},
                query: async (sql, args) => {
                    if (sql === "BEGIN") return { rows: [] }
                    if (sql.startsWith("SELECT pg_advisory")) {
                        const previous = locked
                        locked = new Promise((resolve) => {
                            release = resolve
                        })
                        await previous
                        return { rows: [] }
                    }
                    if (sql === "COMMIT" || sql === "ROLLBACK") {
                        release?.()
                        return { rows: [] }
                    }
                    return pool.query(sql, args)
                }
            }
        }
    }
    return { objects, pool }
}

test("concurrent upload reservations enforce user/global quotas without deleting another owner's files", async () => {
    const { objects, pool } = storageFixture()
    const beforeUser = process.env.MEDIA_USER_MAX_BYTES,
        beforeGlobal = process.env.MEDIA_STORAGE_MAX_BYTES
    process.env.MEDIA_USER_MAX_BYTES = "100"
    process.env.MEDIA_STORAGE_MAX_BYTES = "150"
    try {
        objects.set(key, { uid: 2, kind: "attachment", size: 40 })
        const load = modules({ pool })
        const quota = load("apps/chat-api/services/mediaQuota.ts")
        const requests = await Promise.allSettled(
            Array.from({ length: 4 }, () => quota.reserveMediaUpload(1, "attachment", 40, "pro"))
        )
        assert.equal(requests.filter((r) => r.status === "fulfilled").length, 2)
        assert.equal(objects.get(key).uid, 2)
        assert.equal(objects.size, 3)
        await assert.rejects(quota.reserveMediaUpload(3, "voice", 40, "pro"))
        const storage = load("apps/chat-api/services/mediaStorage.ts")
        assert.throws(() => storage.mediaPath("attachment", "../../outside"))
    } finally {
        if (beforeUser === undefined) delete process.env.MEDIA_USER_MAX_BYTES
        else process.env.MEDIA_USER_MAX_BYTES = beforeUser
        if (beforeGlobal === undefined) delete process.env.MEDIA_STORAGE_MAX_BYTES
        else process.env.MEDIA_STORAGE_MAX_BYTES = beforeGlobal
    }
})

test("shared guest and free media quotas leave space for registered paid accounts", async (t) => {
    const { pool } = storageFixture([1, 2])
    const previous = process.env.MEDIA_STORAGE_MAX_BYTES
    t.after(() => {
        if (previous === undefined) delete process.env.MEDIA_STORAGE_MAX_BYTES
        else process.env.MEDIA_STORAGE_MAX_BYTES = previous
    })
    process.env.MEDIA_STORAGE_MAX_BYTES = "1600"
    const { reserveMediaUpload, MediaQuotaExceeded } = modules({ pool })("apps/chat-api/services/mediaQuota.ts")
    await reserveMediaUpload(1, "voice", 65, "free")
    await assert.rejects(reserveMediaUpload(2, "attachment", 36, "free"), MediaQuotaExceeded)
    await reserveMediaUpload(3, "attachment", 400, "free")
    await assert.rejects(reserveMediaUpload(4, "voice", 1, "free"), MediaQuotaExceeded)
    await reserveMediaUpload(5, "voice", 80, "pro")
})

test("upload budget is shared by account and voice reservations reflect the body and plan", async () => {
    const counts = new Map()
    const redis = {
        async eval(script, keys, key) {
            assert.equal(keys, 1)
            assert.match(script, /EXPIRE.*60/)
            const count = (counts.get(key) ?? 0) + 1
            counts.set(key, count)
            return count
        }
    }
    const quota = modules({ redis })("apps/chat-api/services/mediaQuota.ts")
    for (let n = 0; n < 30; n++) await quota.consumeMediaUploadBudget(1)
    await assert.rejects(quota.consumeMediaUploadBudget(1), quota.MediaQuotaExceeded)
    await quota.consumeMediaUploadBudget(2)
    const free = quota.voiceReservationLimit(45)
    const paid = quota.voiceReservationLimit(180)
    assert.ok(free < paid)
    assert.ok(paid <= 6 * 1024 ** 2)
    assert.equal(quota.mediaReservationBytes("140", free), 140)
    assert.equal(quota.mediaReservationBytes(undefined, free), free)
    assert.equal(quota.mediaReservationBytes(String(paid), free), free)
})

test("DM wallpaper is validated on the server and at each persisted or realtime client boundary", async () => {
    const good = { kind: "image", dataUrl: "data:image/png;base64,UExBWQ==", dim: 24, blur: 10 }
    const bad = { ...good, dataUrl: `${good.dataUrl}\ninvalid` }
    const load = modules({}, {}, { localStorage: { getItem: () => JSON.stringify(bad) } })
    const handlers = new Map()
    load("apps/chat-api/socket/messages/dmWallpaper.ts").default({
        user: { id: 1, username: "actor" },
        socket: { on: (event, handler) => handlers.set(event, handler) }
    })
    let rejected
    await handlers.get("dmWallpaper:set")({ peerUserId: 2, state: bad }, (ack) => { rejected = ack })
    assert.equal(rejected.err, "Некорректные обои")
    const feed = load("apps/frontend/src/features/chat/dmWallpaperSocket.ts")
    assert.equal(feed.parseDmWallpaperUpdate({ peerUserId: 2, state: bad }), null)
    assert.equal(feed.parseDmWallpaperUpdate({ peerUserId: 2, state: good }).state.dataUrl, good.dataUrl)
    let response
    feed.requestDmWallpaper({ emit: (_event, _data, reply) => reply({ state: bad }) }, "peer", (ack) => { response = ack }, 2)
    assert.equal(response.state, undefined)
    const storage = load("apps/frontend/src/features/chat/dmWallpaperStorage.ts")
    assert.equal(storage.loadDmWallpaper("actor", "peer", 1, 2).kind, "none")
    const contract = load("apps/shared/types/contracts/dmWallpaper.ts")
    assert.equal(contract.isWallpaperImageDataUrl(`${good.dataUrl}\n`), false)
    assert.equal(contract.isWallpaperImageDataUrl("data:image/svg+xml;base64,UExBWQ=="), false)
})

test("cleanup removes expired staged files and untracked old files while preserving retained messages", async () => {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "playtime-media-security-"))
    const before = process.env.ATTACHMENT_STORAGE_DIR
    process.env.ATTACHMENT_STORAGE_DIR = directory
    try {
        const { objects, pool } = storageFixture()
        objects.set(key, { uid: 1, kind: "attachment", size: 4, expired: true })
        objects.set(otherKey, { uid: 2, kind: "attachment", size: 4 })
        const untracked = "33333333-3333-4333-8333-333333333333"
        await fsp.mkdir(path.join(directory, "staging"))
        await fsp.writeFile(path.join(directory, "staging", key), "old!")
        await fsp.writeFile(path.join(directory, otherKey), "keep")
        await fsp.writeFile(path.join(directory, untracked), "orphan")
        const old = new Date(Date.now() - 3 * 60 * 60 * 1000)
        await fsp.utimes(path.join(directory, untracked), old, old)
        await modules({ pool })("apps/chat-api/services/mediaStorage.ts").cleanupMediaStorage()
        assert.equal(fs.existsSync(path.join(directory, "staging", key)), false)
        assert.equal(fs.existsSync(path.join(directory, untracked)), false)
        assert.equal(await fsp.readFile(path.join(directory, otherKey), "utf8"), "keep")
        assert.equal(objects.has(key), false)
        assert.equal(objects.has(otherKey), true)
    } finally {
        if (before === undefined) delete process.env.ATTACHMENT_STORAGE_DIR
        else process.env.ATTACHMENT_STORAGE_DIR = before
        await fsp.rm(directory, { recursive: true, force: true })
    }
})

function authFixture() {
    const redis = redisFixture()
    const versions = new Map(), sessions = new Map(), blacklisted = new Set()
    const pool = { connect: async () => ({ query: (...args) => pool.query(...args), release() {} }), query: async (sql, args = []) => {
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] }
        if (sql.startsWith("SELECT auth_version")) return { rows: [{ auth_version: versions.get(args[0]) || 0 }] }
        if (sql.startsWith("UPDATE users SET auth_version")) {
            versions.set(args[0], (versions.get(args[0]) || 0) + 1)
            return { rows: [{ auth_version: versions.get(args[0]) }] }
        }
        if (sql.includes("FROM revoked_access_tokens")) return { rows: (versions.get(args[0]) || 0) === args[1] && !blacklisted.has(args[2]) && (!args[3] || !sessions.get(args[3])?.revoked) ? [{}] : [] }
        if (sql.startsWith("INSERT INTO revoked_access_tokens")) { blacklisted.add(args[0]); return { rows: [] } }
        if (sql.startsWith("INSERT INTO auth_sessions")) {
            if ((versions.get(args[1]) || 0) !== args[3] || sessions.get(args[0])?.revoked) return { rows: [] }
            sessions.set(args[0], { uid: args[1], hash: args[2], version: args[3], revoked: false })
            return { rows: [{ id: args[0] }] }
        }
        if (sql.startsWith("UPDATE auth_sessions s SET")) {
            const found = Array.from(sessions).find(([, row]) => row.hash === args[0] && !row.revoked && (versions.get(row.uid) || 0) === row.version)
            if (!found) return { rows: [] }
            const [session_id, row] = found; row.hash = null
            return { rows: [{ id: row.uid, username: "user" + row.uid, session_version: row.version, session_id }] }
        }
        if (sql.startsWith("UPDATE auth_sessions SET")) {
            for (const row of sessions.values()) if (sql.includes("WHERE user_id") ? row.uid === args[0] : row.hash === args[0]) { row.revoked = true; row.hash = null }
            return { rows: [] }
        }
        return { rows: [{ id: 1, username: "user1" }] }
    } }
    const load = modules(
        { pool, redis, JWT_SECRET: "isolated-security-test-secret-at-least-32-characters" },
        {
            "apps/auth-api/auth/userAccount.ts": { isUserAccountBlocked: async () => false },
            "apps/room-api/socket/directCall/ownership.ts": { registerCallEndpoint: async () => {} },
            "apps/auth-api/http/authRateLimits.ts": {
                createAuthRateLimiters: () => {
                    const pass = (_req, _res, next) => next()
                    return {
                        loginRegisterLimiter: pass,
                        tokenValidLimiter: pass,
                        refreshLimiter: pass,
                        revokeLimiter: pass
                    }
                }
            }
        }
    )
    return { load, redis, pool, auth: load("apps/auth-api/auth/index.ts"), version: load("apps/auth-api/auth/sessionVersion.ts") }
}

test("changing a password invalidates old access and refresh sessions and disconnects all devices after acknowledgement", async () => {
    const fixture = authFixture()
    const { load, auth, version, pool } = fixture
    const access = auth.signUserAccessToken({ id: 1, username: "user1", sessionVersion: 0 })
    const refresh = await auth.issueRefreshToken({ id: 1, username: "user1", sessionVersion: 0 })
    const bcrypt = backendRequire("bcrypt")
    let hash = await bcrypt.hash("old-password", 4)
    let recoveryCodePresent = true
    const authQuery = pool.query
    pool.query = async (sql, args) => {
        if (sql.startsWith("SELECT password_hash")) return { rows: [{ password_hash: hash }] }
        if (sql.startsWith("DELETE FROM password_recovery")) {
            assert.deepEqual([...args], [1])
            recoveryCodePresent = false
            return { rows: [] }
        }
        if (sql.startsWith("UPDATE users SET password_hash")) {
            hash = args[0]
            await authQuery("UPDATE users SET auth_version = auth_version + 1", [args[1]])
            return { rows: [{ id: args[1] }] }
        }
        return authQuery(sql, args)
    }
    const handlers = new Map(),
        order = []
    load("apps/auth-api/socket/account.ts").default({
        user: { id: 1, username: "user1" },
        socket: { data: { accessSession: await auth.verifyUserAccessToken(access) }, on: (name, handler) => handlers.set(name, handler) },
        io: {
            to: () => ({ emit: () => order.push("event") }),
            in: () => ({ disconnectSockets: () => order.push("disconnect") })
        }
    })
    let acknowledgement
    await handlers.get("user:changePassword")(
        { currentPassword: "old-password", newPassword: "new-password" },
        (result) => {
            acknowledgement = result
            order.push("ack")
        }
    )
    assert.equal(acknowledgement.success, true)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(await bcrypt.compare("new-password", hash), true)
    assert.equal(recoveryCodePresent, false)
    assert.equal(await version.getSessionVersion(1), 1)
    await assert.rejects(auth.verifyUserAccessToken(access))
    assert.equal(await auth.takeRefreshToken(refresh), null)
    assert(order.indexOf("ack") < order.indexOf("disconnect"))
})

test("account deletion rechecks the verified password while holding the user lock", async () => {
    const { load, auth, pool } = authFixture()
    const token = auth.signUserAccessToken({ id: 1, username: "user1", sessionVersion: 0 })
    const session = await auth.verifyUserAccessToken(token)
    const statements = []
    pool.query = async (sql) => {
        statements.push(sql)
        return { rows: sql.includes("FOR UPDATE") ? [{ password_hash: "changed-while-waiting" }] : [] }
    }
    const { updateAccountCredentials } = load("apps/auth-api/auth/accountCredentials.ts")
    assert.equal(await updateAccountCredentials(session, "previous-password-hash", null), false)
    assert.deepEqual(statements, ["BEGIN", "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE", "ROLLBACK"])
})

test("WebRTC signaling forwards only the negotiated description and ICE candidate fields", () => {
    const { readSignalPayload } = modules()("apps/room-api/socket/webrtc/signalPayload.ts")
    const offer = readSignalPayload("offer", { type: "offer", sdp: "v=0", debugContext: "unused" })
    assert.deepEqual({ ...offer }, { type: "offer", sdp: "v=0" })
    assert.equal(readSignalPayload("answer", { type: "offer", sdp: "v=0" }), null)
    const candidate = readSignalPayload("ice", { candidate: "candidate:1", sdpMid: "audio", sdpMLineIndex: 0 })
    assert.equal(candidate.candidate, "candidate:1")
    assert.equal(candidate.sdpMLineIndex, 0)
    assert.equal(readSignalPayload("ice", { candidate: "candidate:1", sdpMLineIndex: -1 }), null)
})

async function socketFixture(t) {
    const fixture = authFixture()
    const server = http.createServer(),
        io = new Server(server)
    io.use(fixture.load("apps/gateway/legacy/socketAuth.ts").authSocket)
    let writes = 0,
        currentSocket
    io.on("connection", (socket) => {
        currentSocket = socket
        socket.on("error", () => {})
        socket.join(fixture.version.accessSessionRoom(socket.data.accessSession.jti))
        socket.on("change", (callback) => {
            writes++
            callback({ ok: true })
        })
    })
    await new Promise((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", resolve)
    })
    const clients = []
    t.after(async () => {
        for (const client of clients) client.disconnect()
        await new Promise((resolve) => io.close(resolve))
        server.close()
    })
    const mint = (jti, seconds = 60, uid = 1) =>
        jwt.sign(
            { id: uid, username: "user" + uid, jti, sv: 0 },
            "isolated-security-test-secret-at-least-32-characters",
            { expiresIn: seconds }
        )
    return {
        ...fixture,
        io,
        server,
        mint,
        writes: () => writes,
        socket: () => currentSocket,
        connect: async (token) => {
            const client = connectClient("http://127.0.0.1:" + server.address().port, {
                transports: ["websocket"],
                auth: { token },
                reconnection: false
            })
            clients.push(client)
            await new Promise((resolve, reject) => {
                client.once("connect", resolve)
                client.once("connect_error", reject)
            })
            return client
        }
    }
}

test("connected sockets reject further writes after token revocation", async (t) => {
    const fixture = await socketFixture(t)
    const client = await fixture.connect(fixture.mint("revoked"))
    await fixture.auth.blacklistAccessJti("revoked", Math.floor(Date.now() / 1000) + 60)
    const disconnected = once(client, "disconnect")
    client.emit("change", () => {})
    await disconnected
    assert.equal(fixture.writes(), 0)
})

test("JWT expiration closes an idle connection without requiring an incoming packet", async (t) => {
    const fixture = await socketFixture(t)
    const client = await fixture.connect(fixture.mint("expired", 2))
    await once(client, "disconnect")
    assert.equal(client.connected, false)
    assert.equal(fixture.writes(), 0)
})

test("reauthentication extends the connection and cannot switch to another user", async (t) => {
    const fixture = await socketFixture(t)
    const client = await fixture.connect(fixture.mint("original", 2))
    client.emit("auth:refresh", { token: fixture.mint("renewed", 60) })
    await waitFor(() => fixture.socket().data.accessSession.jti === "renewed")
    fixture.io.in(fixture.version.accessSessionRoom("original")).disconnectSockets(true)
    assert.equal((await client.timeout(1000).emitWithAck("change")).ok, true)
    const disconnected = once(client, "disconnect")
    client.emit("auth:refresh", { token: fixture.mint("different-user", 60, 2) })
    await disconnected
    assert.equal(fixture.writes(), 1)
})

test("history and live room messages recover media keys exclusively from their E2EE content", async () => {
    const nacl = require("tweetnacl")
    const symmetric = nacl.randomBytes(32)
    const load = modules({}, { "apps/frontend/src/features/chat/keyVault.ts": {
        currentKeyUserId: () => 1,
        readSecret: name => name === "room:7" ? Buffer.from(symmetric).toString("base64") : null
    } })
    const crypto = load("apps/frontend/src/features/chat/mediaEncryption.ts")
    const rooms = load("apps/frontend/src/features/chat/roomE2ee.ts")
    const encrypted = await crypto.encryptMedia(new Blob(["private file"]))
    const descriptor = {
        kind: "attachment",
        storageKey: key,
        key: encrypted.key,
        nonce: encrypted.nonce,
        mime: "text/plain",
        filename: "original.txt",
        sizeBytes: 12
    }
    const content = rooms.encryptRoomPlaintext(crypto.encodeMediaMessage(descriptor), symmetric)
    let messages = []
    const history = new (load("apps/frontend/src/features/chat/hooks/useChatMessages/messageHistoryTracker.ts").MessageHistoryTracker)()
    history.beginLatest("security-media", [], [])
    const handlers = load("apps/frontend/src/features/chat/hooks/useChatMessages/createSocketHandlers.ts").createChatSocketHandlers({
        socket: { emit() {} },
        g: 1,
        loadGenRef: { current: 1 },
        history,
        is_room: true,
        id: 7,
        name: "test",
        myName: "me",
        myUserId: 1,
        setChatMessages: (update) => {
            messages = typeof update === "function" ? update(messages) : update
        },
        setHistoryLoading() {},
        setRoomMembersEpoch() {},
        peerPubRef: { current: null },
        setPeerTyping() {},
        setRoomChatMeta() {}
    })
    await handlers.handleGetMessages({
        requestId: "security-media",
        messages: [
            {
                id: 1,
                content,
                created_at: new Date().toISOString(),
                attachment_storage_key: key,
                attachment_mime: "image/svg+xml",
                attachment_filename: "injected.svg",
                attachment_size: 99
            }
        ]
    })
    assert.equal(messages[0].attachment.mime, "text/plain")
    assert.equal(messages[0].attachment.filename, "original.txt")
    assert.equal(messages[0].attachment.media.key, encrypted.key)
    await handlers.handleReceiveMessage({
        id: 2,
        roomId: 7,
        from: "friend",
        content,
        attachmentKey: key,
        attachmentMime: "image/svg+xml"
    })
    assert.equal(messages[1].attachment.media.key, encrypted.key)
    assert.equal(messages[1].text.includes(encrypted.key), false)
    const preview = load("apps/frontend/src/server/socket/preview.ts")
    assert.equal(preview.previewPlainToSidebarLabel(crypto.encodeMediaMessage(descriptor)), "Вложение")
})

test("HTTP uploads store ciphertext, ignore spoofed socket metadata and protect downloads by membership", async (t) => {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "playtime-upload-security-"))
    const previousDir = process.env.ATTACHMENT_STORAGE_DIR
    process.env.ATTACHMENT_STORAGE_DIR = directory
    const { objects, pool } = storageFixture(),
        staged = new Map()
    const baseQuery = pool.query
    const baseConnect = pool.connect
    let committed = false
    pool.connect = async () => {
        const client = await baseConnect()
        return {
            ...client,
            async query(sql, args) {
                const result = await client.query(sql, args)
                if (sql === "COMMIT") committed = true
                return result
            }
        }
    }
    let message, sent, pushed
    pool.query = async (sql, args = []) => {
        if (sql.startsWith("UPDATE media_objects SET size_bytes")) {
            const object = objects.get(args[0])
            object.size = args[1]
            return { rowCount: 1, rows: [{}] }
        }
        if (sql.startsWith("UPDATE media_objects SET finalized_at")) return { rows: [] }
        if (sql.startsWith("INSERT INTO attachment_staging")) {
            staged.set(args[0], { user_id: args[1], mime: args[2], filename: args[3], size_bytes: args[4] })
            return { rows: [] }
        }
        if (sql.startsWith("DELETE FROM attachment_staging")) {
            staged.delete(args[0])
            return { rows: [] }
        }
        if (sql.startsWith("SELECT s.mime")) {
            const row = staged.get(args[0])
            return { rows: row?.user_id === args[1] ? [row] : [] }
        }
        if (sql.startsWith("SELECT 1 FROM attachment_staging")) return { rows: staged.has(args[0]) ? [{}] : [] }
        if (sql.startsWith("SELECT 1 FROM messages m JOIN room_members")) return { rows: [1, 2].includes(args[0]) ? [{}] : [] }
        if (sql.startsWith("SELECT 1 FROM room_members")) return { rows: [1, 2].includes(args[1]) ? [{}] : [] }
        if (sql.startsWith("INSERT INTO messages")) {
            message = {
                id: 10,
                room_id: args[1],
                sender_id: args[0],
                receiver_id: null,
                attachment_storage_key: args[6],
                attachment_mime: args[7],
                attachment_filename: args[8],
                attachment_size: args[9]
            }
            return { rows: [{ id: 10, created_at: new Date() }] }
        }
        if (sql.includes("u_from.guest_original_username") && sql.includes("AS sender_username"))
            return { rows: [{ reply_to_id: null, reply_from: null, reply_preview: null }] }
        if (sql.includes("INNER JOIN room_e2ee_wraps") || sql.includes("COALESCE(rw.e2ee_visible_after_id")) return { rows: [{ user_id: 1 }, { user_id: 2 }] }
        if (sql.startsWith("SELECT name FROM rooms")) return { rows: [{ name: "room" }] }
        if (sql.startsWith("INSERT INTO push_outbox")) {
            pushed = args
            return { rows: [] }
        }
        if (sql.includes("FROM messages WHERE attachment_storage_key")) return { rows: message ? [message] : [] }
        return baseQuery(sql, args)
    }
    const load = modules(
        { pool, redis: { eval: async () => 1 } },
        {
            "apps/database/subscriptionPlans.ts": {
                getLimitsForUser: async () => ({ planSlug: "free", limits: { maxAttachmentBytes: 1024, maxVoiceMessageSec: 120 } })
            },
            "apps/shared/http/bearerAuth.ts": {
                bearerAuthMiddleware: (req, _res, next) => {
                    req.userId = Number(req.header("x-test-user") || 1)
                    next()
                }
            }
        }
    )
    const app = backendRequire("express")()
    app.use("/attachments", load("apps/chat-api/routes/attachments.ts").default)
    const server = http.createServer(app)
    t.after(async () => {
        server.closeAllConnections()
        await new Promise((resolve) => server.close(resolve))
        if (previousDir === undefined) delete process.env.ATTACHMENT_STORAGE_DIR
        else process.env.ATTACHMENT_STORAGE_DIR = previousDir
        await fsp.rm(directory, { recursive: true, force: true })
    })
    await new Promise((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", resolve)
    })
    const base = "http://127.0.0.1:" + server.address().port + "/attachments"
    const form = (blob) => {
        const data = new FormData()
        data.append("file", blob, "spoof.svg")
        return data
    }
    assert.equal((await fetch(base + "/upload", { method: "POST", body: form(new Blob(["plaintext"])) })).status, 400)
    assert.equal(objects.size, 0)
    assert.equal(
        (
            await fetch(base + "/upload", {
                method: "POST",
                headers: { "X-Playtime-Media-Format": "secretbox-v1" },
                body: form(new Blob(["<svg/>"], { type: "image/png" }))
            })
        ).status,
        400
    )
    await waitFor(() => objects.size === 0)
    const crypto = load("apps/frontend/src/features/chat/mediaEncryption.ts"),
        plaintext = new Blob(["private upload bytes"])
    const encrypted = await crypto.encryptMedia(plaintext)
    const response = await fetch(base + "/upload", {
        method: "POST",
        headers: { "X-Playtime-Media-Format": "secretbox-v1" },
        body: form(encrypted.blob)
    })
    assert.equal(response.status, 200)
    const upload = await response.json()
    assert.equal(upload.mime, "application/octet-stream")
    assert.equal(upload.filename, "attachment.bin")
    const handlers = new Map()
    const fanoutStarted = Promise.withResolvers()
    const fanoutFinished = Promise.withResolvers()
    let recipientSawCommit = false
    load("apps/chat-api/socket/messages/send.ts").default({
        user: { id: 1, username: "sender" },
        socket: {
            on: (event, handler) => handlers.set(event, handler),
            emit: (event, value) => {
                if (event === "message:send:error") assert.fail(value.err)
            }
        },
        io: {
            to: (room) => ({
                async emitConfirmed(_event, value) {
                    sent = value
                    if (room === "2") {
                        recipientSawCommit = committed
                        fanoutStarted.resolve()
                        await fanoutFinished.promise
                    }
                }
            })
        }
    })
    const content =
        "R2E1:" + JSON.stringify({ n: Buffer.alloc(24).toString("base64"), b: Buffer.alloc(16).toString("base64") })
    committed = false
    let receipt
    const send = handlers.get("message:send")(
        {
            roomId: 7,
            content,
            attachmentKey: upload.attachmentKey,
            attachmentMime: "image/svg+xml",
            attachmentFilename: "attack.svg",
            attachmentSize: 1
        },
        (result) => {
            receipt = result
        }
    )
    await Promise.race([fanoutStarted.promise, send])
    try {
        assert.equal(recipientSawCommit, true)
        assert.equal(receipt, undefined)
    } finally {
        fanoutFinished.resolve()
    }
    await send
    assert.equal(receipt?.success, true)
    assert.equal(receipt.id, message.id)
    assert.equal(message.attachment_mime, "application/octet-stream")
    assert.equal(message.attachment_size, encrypted.blob.size)
    assert.equal(sent.attachmentMime, "application/octet-stream")
    assert.deepEqual([...pushed[0]], [2])
    assert.equal(pushed[5], message.id)
    const downloaded = await fetch(base + "/" + upload.attachmentKey, { headers: { "X-Test-User": "2" } })
    assert.equal(downloaded.status, 200)
    assert.equal(downloaded.headers.get("content-type"), "application/octet-stream")
    assert.match(downloaded.headers.get("content-disposition"), /^attachment;/)
    const descriptor = {
        kind: "attachment",
        storageKey: upload.attachmentKey,
        key: encrypted.key,
        nonce: encrypted.nonce,
        mime: "text/plain",
        filename: "private.txt",
        sizeBytes: plaintext.size
    }
    const opened = await crypto.mediaBlobForPlayback(await downloaded.blob(), "application/octet-stream", descriptor)
    assert.equal(await opened.text(), "private upload bytes")
    assert.equal((await fetch(base + "/" + upload.attachmentKey, { headers: { "X-Test-User": "3" } })).status, 403)
    assert.equal(objects.size, 1)
})

test("logout immediately disconnects only sockets belonging to the supplied access token", async (t) => {
    const fixture = await socketFixture(t)
    const token = fixture.mint("logging-out")
    const first = await fixture.connect(token)
    const second = await fixture.connect(fixture.mint("another-device"))
    const app = backendRequire("express")()
    app.set("io", fixture.io)
    app.use(backendRequire("express").json())
    app.use("/auth", fixture.load("apps/auth-api/routes/auth.ts").default)
    fixture.server.on("request", app)
    const disconnected = once(first, "disconnect")
    const response = await fetch("http://127.0.0.1:" + fixture.server.address().port + "/auth/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
    })
    assert.equal(response.status, 200)
    await disconnected
    assert.equal(first.connected, false)
    assert.equal((await second.timeout(1000).emitWithAck("change")).ok, true)
    await fixture.auth.verifyUserAccessToken(fixture.mint("another-device"))
})

test("mac packaging falls back to ad-hoc signing while preserving Developer ID and explicit identities", async () => {
    const { ensureSigningIdentity } = require("../prepare-mac-sign.cjs")
    const automatic = {}
    await ensureSigningIdentity(automatic, async () => null)
    assert.equal(automatic.identity, "-")
    const developer = {}
    await ensureSigningIdentity(developer, async () => ({ name: "Developer ID Application: Test" }))
    assert.equal(developer.identity, undefined)
    for (const identity of ["-", "explicit certificate", null]) {
        const options = { identity }
        await ensureSigningIdentity(options, async () => assert.fail("explicit identity must be preserved"))
        assert.equal(options.identity, identity)
    }
})

test("updater parses multiline release notes without altering version or artifact checksums", () => {
    const { buildUpdaterFeedYaml } = modules()("apps/gateway/releases/releaseService.ts")
    const { parseUpdateInfo } = require("electron-updater/out/providers/Provider")
    const notes = 'Восстановление звонка при смене VPN.\nversion: "not-a-version"\n---\nКлючи: "резервная копия"'
    const row = {
        version: "2.0.6",
        platform: "darwin",
        filename: "PlayTime-2.0.6.dmg",
        update_filename: "PlayTime-2.0.6-mac.zip",
        file_size: "900",
        update_file_size: "800",
        sha512: "installer-checksum",
        update_sha512: "updater-checksum",
        release_notes: notes,
        published_at: new Date("2026-10-25T10:00:00Z")
    }
    const parse = (release) =>
        parseUpdateInfo(buildUpdaterFeedYaml(release), "latest-mac.yml", "https://example.test/latest-mac.yml")
    const info = parse(row)
    assert.equal(info.version, "2.0.6")
    assert.equal(info.releaseNotes, notes)
    assert.equal(info.sha512, "updater-checksum")
    assert.equal(info.files[0].sha512, "updater-checksum")
    assert.equal(info.files[0].size, 800)
    assert.ok(info.files[0].url.endsWith("/darwin/PlayTime-2.0.6-mac.zip"))
    assert.equal(parse({ ...row, release_notes: null }).releaseNotes, undefined)
    assert.equal(parse({ ...row, release_notes: " \n " }).releaseNotes, undefined)
})

test("migration discovery ignores macOS metadata and hidden SQL files", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "playtime-migration-metadata-"))
    const applied = []
    const client = {
        query: async (sql, args) => {
            if (sql.startsWith("INSERT INTO schema_migrations")) applied.push(args[0])
            if (sql.includes("APPLEDOUBLE") || sql.includes("HIDDEN")) throw Error("metadata was executed")
            return { rows: [] }
        },
        release() {}
    }
    const pool = { query: async () => ({ rows: [] }), connect: async () => client }
    try {
        fs.mkdirSync(path.join(directory, "migrations"))
        fs.writeFileSync(path.join(directory, "migrations/._017_media_storage.sql"), "APPLEDOUBLE")
        fs.writeFileSync(path.join(directory, "migrations/.hidden.sql"), "HIDDEN")
        fs.writeFileSync(path.join(directory, "migrations/017_media_storage.sql"), "SELECT 1;")
        const { runPendingMigrations } = modules({ pool })("apps/database/runMigrations.ts")
        await runPendingMigrations(path.join(directory, "migrations"))
        assert.deepEqual(applied, ["017_media_storage.sql"])
    } finally {
        fs.rmSync(directory, { recursive: true, force: true })
    }
})
