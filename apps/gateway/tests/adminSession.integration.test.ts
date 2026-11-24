import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { after, before, beforeEach, mock, test } from "node:test"
import { once } from "node:events"
import http, { type Server } from "node:http"
import express from "express"
import Redis from "ioredis"
import { pool, redis } from "../../shared/config"
import {
    ADMIN_SESSION_COOKIE,
    ADMIN_SESSION_IDLE_MS,
    adminSessionStorageKey,
    closeAdminSessionStore
} from "../admin/adminSession"
import { adminSessionRouter } from "../routes/adminSession"
import { adminSessionMiddleware } from "../middlewares/adminSessionMiddleware"

const origin = "https://site.example.test"
const key = Buffer.alloc(32, 0x42).toString("base64url")
const otherKey = Buffer.alloc(32, 0x43).toString("base64url")
const hash = (value: string) => createHash("sha256").update(value).digest("hex")
const fingerprint = hash(key)
const ip = "192.0.2.2"
let server: Server, base: string

before(async () => {
    if (process.env.REDIS_URL !== "redis://127.0.0.1:16389/2") {
        throw new Error("Use dedicated ephemeral Redis DB 2 on localhost:16389")
    }
    const app = express()
    app.use("/playtime/admin", adminSessionRouter)
    app.use(express.json({ limit: "32kb" }))
    app.get("/playtime/admin/access", adminSessionMiddleware, (_req, res) => {
        res.json({ allowed: true, session: res.locals.adminSession })
    })
    app.patch("/playtime/admin/change", adminSessionMiddleware, (_req, res) => res.json({ changed: true }))
    server = app.listen(0, "127.0.0.1")
    await once(server, "listening")
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
beforeEach(async () => {
    process.env.NODE_ENV = "production"
    process.env.ADMIN_ACCESS_KEY_HASH = fingerprint
    process.env.ADMIN_SESSION_SIGNING_KEY = Buffer.alloc(32, 42).toString("hex")
    process.env.SITE_ORIGIN = origin
    await redis.flushdb()
})
after(async () => {
    if (server) {
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    closeAdminSessionStore()
    await redis.quit()
    await pool.end()
})

const headers = (extra: Record<string, string> = {}) => ({
    Origin: origin,
    "Content-Type": "application/json",
    "X-PlayTime-Admin": "1",
    "X-Real-IP": ip,
    ...extra
})
const login = (value = key, extra: Record<string, string> = {}) =>
    fetch(`${base}/playtime/admin/session`, {
        method: "POST",
        headers: headers(extra),
        body: JSON.stringify({ key: value })
    })
const cookie = (response: Response) => response.headers.get("set-cookie")!.split(";")[0]
const token = (value: string) => value.slice(value.indexOf("=") + 1)
const access = (value = "", extra: Record<string, string> = {}) =>
    fetch(`${base}/playtime/admin/access`, {
        headers: { Cookie: value, "X-Real-IP": ip, ...extra }
    })
const storedSession = (value: string, fp = fingerprint) => adminSessionStorageKey(token(value), fp)
const serverNow = async () => {
    const time = await redis.time()
    return Number(time[0]) * 1000 + Math.floor(Number(time[1]) / 1000)
}

test("fixed key yields an HttpOnly host-only eight-hour cookie and only hashed Redis credentials", async () => {
    assert.equal((await access()).status, 401)
    const response = await login()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("cache-control"), "no-store")
    const setCookie = response.headers.get("set-cookie")!
    assert.match(setCookie, /HttpOnly/)
    assert.match(setCookie, /Secure/)
    assert.match(setCookie, /SameSite=Strict/)
    assert.match(setCookie, /Path=\/playtime\/admin/)
    assert.match(setCookie, /Max-Age=28800/)
    assert.doesNotMatch(setCookie, /Domain=/)
    const sessionCookie = cookie(response)
    assert.match(token(sessionCookie), /^[A-Za-z0-9_-]{43}$/)
    const body = await response.json()
    assert.equal(body.allowed, true)
    assert.equal(Date.parse(body.session.expiresAt) - Date.parse(body.session.createdAt), 8 * 60 * 60 * 1000)
    assert.equal(JSON.stringify(body).includes(key), false)
    assert.equal(JSON.stringify(body).includes(token(sessionCookie)), false)
    const keys = await redis.keys("playtime:admin:session:*")
    assert.deepEqual(keys, [storedSession(sessionCookie)])
    assert.equal(keys[0].includes(token(sessionCookie)), false)
    assert.equal(keys[0].includes(key), false)
    assert.ok((await redis.pttl(keys[0])) <= ADMIN_SESSION_IDLE_MS)
    const persisted = await redis.get(keys[0])
    assert.deepEqual(Object.keys(JSON.parse(persisted!)).sort(), ["createdAt", "expiresAt", "idleExpiresAt"])
    assert.equal(persisted!.includes(ip), false)
    assert.equal((await access(sessionCookie, { "X-Real-IP": "198.51.100.7" })).status, 200)
})

test("one wrong key blocks only new logins from that IP for thirty minutes, even the correct key", async () => {
    const active = cookie(await login())
    const wrong = await login(otherKey)
    assert.equal(wrong.status, 401)
    assert.equal(wrong.headers.get("retry-after"), "1800")
    const beforeBlocked = await redis.get("playtime:admin:login:budget")
    const denied = await login(key, { "X-Forwarded-For": "198.51.100.99" })
    assert.equal(await redis.get("playtime:admin:login:budget"), beforeBlocked)
    assert.equal(denied.status, 429)
    assert.ok(Number(denied.headers.get("retry-after")) >= 1790)
    assert.equal((await access(active)).status, 200, "Wrong login cannot revoke an active admin session")
    assert.equal((await login(key, { "X-Real-IP": "192.0.2.3" })).status, 200)
    const blocks = await redis.keys("playtime:admin:login:blocked:*")
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].includes(ip), false)
    assert.ok((await redis.ttl(blocks[0])) > 1790)
    await redis.pexpire(blocks[0], 1)
    await new Promise((resolve) => setTimeout(resolve, 5))
    assert.equal((await login()).status, 200)
})

test("a slow wrong-key request serializes a concurrent correct login and cannot be bypassed", async () => {
    const payload = JSON.stringify({ key: otherKey })
    let incoming: http.ClientRequest
    const result = new Promise<{ status: number; retry: string | undefined }>((resolve, reject) => {
        incoming = http.request(
            `${base}/playtime/admin/session`,
            {
                method: "POST",
                headers: { ...headers(), "Content-Length": Buffer.byteLength(payload) }
            },
            (response) => {
                response.resume()
                response.on("end", () =>
                    resolve({ status: response.statusCode!, retry: response.headers["retry-after"] })
                )
            }
        )
        incoming.on("error", reject)
        incoming.write('{"key":"')
    })
    for (let count = 0; count < 100; count++) {
        if ((await redis.keys("playtime:admin:login:attempt:*")).length) break
        await new Promise((resolve) => setTimeout(resolve, 5))
    }
    assert.equal((await redis.keys("playtime:admin:login:attempt:*")).length, 1)
    assert.equal((await login()).status, 429)
    incoming!.end(`${otherKey}"}`)
    assert.deepEqual(await result, { status: 401, retry: "1800" })
    assert.equal((await login()).status, 429)
    assert.equal((await redis.keys("playtime:admin:session:*")).length, 0)
})

test("key rotation invalidates old cookies immediately and old login blocks do not cross rotation", async () => {
    const oldCookie = cookie(await login())
    await login(otherKey)
    process.env.ADMIN_ACCESS_KEY_HASH = hash(otherKey)
    assert.equal((await access(oldCookie)).status, 401)
    const rotated = await login(otherKey, { Cookie: oldCookie })
    assert.equal(rotated.status, 200)
    const current = cookie(rotated)
    assert.equal((await access(current)).status, 200)
    assert.equal(await redis.exists(storedSession(current, hash(otherKey))), 1)
    assert.equal((await access(oldCookie, { "X-Real-IP": "127.0.0.1" })).status, 401)
})

test("successful re-login replaces its previous cookie and logout revokes on the server", async () => {
    const first = cookie(await login())
    const second = cookie(await login(key, { Cookie: first }))
    assert.notEqual(first, second)
    assert.equal((await access(first)).status, 401)
    assert.equal((await access(second)).status, 200)
    const response = await fetch(`${base}/playtime/admin/session`, {
        method: "DELETE",
        headers: headers({ Cookie: second })
    })
    assert.equal(response.status, 204)
    assert.match(response.headers.get("set-cookie")!, /Expires=Thu, 01 Jan 1970/)
    assert.equal(await redis.exists(storedSession(second)), 0)
    assert.equal((await access(second)).status, 401)
})

test("idle expiry, renewal and absolute expiry are enforced using server time", async () => {
    const current = cookie(await login())
    const storageKey = storedSession(current)
    const now = await serverNow()
    const original = { createdAt: now - 600_000, expiresAt: now + 27_600_000, idleExpiresAt: now + 1000 }
    await redis.set(storageKey, JSON.stringify(original), "PX", 1000)
    const refreshed = await access(current)
    assert.equal(refreshed.status, 200)
    const metadata = (await refreshed.json()).session
    assert.equal(Date.parse(metadata.expiresAt), original.expiresAt)
    assert.ok(Date.parse(metadata.idleExpiresAt) > now + 1_790_000)
    assert.ok((await redis.pttl(storageKey)) > 1_790_000)
    await redis.set(storageKey, JSON.stringify({ ...original, idleExpiresAt: now - 1 }), "PX", 1000)
    assert.equal((await access(current)).status, 401)
    assert.equal(await redis.exists(storageKey), 0)
    await redis.set(
        storageKey,
        JSON.stringify({ createdAt: now - 28_800_001, expiresAt: now - 1, idleExpiresAt: now + 1000 }),
        "PX",
        1000
    )
    assert.equal((await access(current)).status, 401)
    assert.equal(await redis.exists(storageKey), 0)
})

test("missing or invalid configuration fails closed without a localhost/IP fallback", async () => {
    const current = cookie(await login())
    for (const value of ["", "not-a-hash", "A".repeat(64)]) {
        process.env.ADMIN_ACCESS_KEY_HASH = value
        assert.equal((await access(current, { "X-Real-IP": "127.0.0.1" })).status, 503)
        assert.equal((await login()).status, 503)
    }
    delete process.env.ADMIN_ACCESS_KEY_HASH
    assert.equal((await access(current)).status, 503)
})

test("strict origin, Fetch Metadata and custom mutation header protect login, logout and admin writes", async () => {
    const current = cookie(await login())
    const deniedHeaders: Record<string, string>[] = [
        { Origin: "" },
        { Origin: "https://evil.example.test", Host: "site.example.test" },
        { Origin: "https://site.example.test.evil.test" },
        { "Sec-Fetch-Site": "cross-site" },
        { "X-PlayTime-Admin": "" }
    ]
    for (const extra of deniedHeaders) {
        assert.equal((await login(key, extra)).status, 403)
        assert.equal(
            (
                await fetch(`${base}/playtime/admin/session`, {
                    method: "DELETE",
                    headers: headers({ Cookie: current, ...extra })
                })
            ).status,
            403
        )
        assert.equal(
            (
                await fetch(`${base}/playtime/admin/change`, {
                    method: "PATCH",
                    headers: headers({ Cookie: current, ...extra }),
                    body: "{}"
                })
            ).status,
            403
        )
    }
    assert.equal((await access(current)).status, 200, "Same-origin GET needs no Origin header")
    assert.equal((await access(current, { Origin: "https://evil.example.test" })).status, 403)
    assert.equal((await access(current, { "Sec-Fetch-Site": "cross-site" })).status, 403)
    assert.equal((await login(key, { Origin: "https://www.site.example.test", "X-Real-IP": "192.0.2.3" })).status, 200)
    assert.equal((await access(current, { Origin: origin })).status, 200)
})

test("bounded JSON is parsed before any global parser and malformed bodies do not create sessions", async () => {
    const bodies = ["{", "null", "[]", "{}", '{"key":3}', JSON.stringify({ key, extra: true })]
    for (const [index, body] of bodies.entries()) {
        const response = await fetch(`${base}/playtime/admin/session`, {
            method: "POST",
            headers: headers({ "X-Real-IP": `192.0.2.${index + 10}` }),
            body
        })
        assert.equal(response.status, 400)
    }
    assert.equal(
        (
            await fetch(`${base}/playtime/admin/session`, {
                method: "POST",
                headers: headers(),
                body: JSON.stringify({ key: "x".repeat(1024) })
            })
        ).status,
        413
    )
    assert.equal((await login(key, { "Content-Type": "text/plain" })).status, 415)
    assert.equal((await redis.keys("playtime:admin:session:*")).length, 0)
    assert.equal((await redis.keys("playtime:admin:login:blocked:*")).length, 0)
})

test("unsupported session methods have an explicit API response", async () => {
    const response = await fetch(`${base}/playtime/admin/session`)
    assert.equal(response.status, 405)
    assert.equal(response.headers.get("allow"), "POST, DELETE")
    assert.match(response.headers.get("content-type")!, /application\/json/)
})

test("malformed JSON never spends the global key budget", async () => {
    const responses = await Promise.all(
        Array.from({ length: 15 }, (_, index) =>
            fetch(`${base}/playtime/admin/session`, {
                method: "POST",
                headers: headers({ "X-Real-IP": `198.51.100.${index + 1}` }),
                body: "{"
            })
        )
    )
    assert.ok(responses.every((response) => response.status === 400))
    assert.equal(await redis.exists("playtime:admin:login:budget"), 0)
    assert.equal((await redis.keys("playtime:admin:login:blocked:*")).length, 0)
    assert.equal((await login()).status, 200)
})

test("a full global wrong-key budget cannot block an administrator with the correct key", async () => {
    await redis.set("playtime:admin:login:budget", 300, "EX", 10)
    assert.equal((await login(otherKey)).status, 429)
    assert.equal((await login()).status, 200)
    assert.equal(await redis.get("playtime:admin:login:budget"), "300")
})

test("cookie ambiguity and corrupt Redis data never authenticate", async () => {
    const current = cookie(await login())
    assert.equal((await access(`${current}; ${current}`)).status, 401)
    assert.equal((await access(`${ADMIN_SESSION_COOKIE}=bad`)).status, 401)
    await redis.set(storedSession(current), "not-json", "PX", 1000)
    assert.equal((await access(current)).status, 401)
    assert.equal(await redis.exists(storedSession(current)), 0)
})

test("Redis failures fail closed for login, existing sessions and logout without exposing credentials", async () => {
    const current = cookie(await login())
    const failure = mock.method(Redis.prototype, "eval", async () => {
        throw new Error("isolated outage")
    })
    try {
        for (const response of [
            await login(),
            await access(current),
            await fetch(`${base}/playtime/admin/session`, { method: "DELETE", headers: headers({ Cookie: current }) })
        ]) {
            assert.equal(response.status, 503)
            const text = await response.text()
            assert.equal(text.includes(key), false)
            assert.equal(text.includes(token(current)), false)
        }
    } finally {
        failure.mock.restore()
    }
    assert.equal((await access(current)).status, 200)
})

test("a stalled Redis command has a bounded authentication response time", async () => {
    const failure = mock.method(Redis.prototype, "eval", () => new Promise<never>(() => {}))
    const started = performance.now()
    try {
        assert.equal((await login()).status, 503)
        assert.ok(performance.now() - started < 3500)
    } finally {
        failure.mock.restore()
    }
})
