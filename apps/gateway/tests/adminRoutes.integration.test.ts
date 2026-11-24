import assert from "node:assert/strict"
import { after, before, test, mock } from "node:test"
import { createHash, randomBytes } from "node:crypto"
import { once } from "node:events"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Server } from "node:http"
import type { Request } from "express"

const origin = "https://admin-routes.example.test"
const legacyAllowedIp = "192.0.2.40"
const spaMarker = "admin-routes-SPA-fallback-must-not-authorize"
const releaseSecret = randomBytes(32).toString("base64url")
const fingerprint = createHash("sha256").update(randomBytes(32)).digest("hex")
let server: Server | undefined,
    base = "",
    siteDirectory = "",
    databaseCalls = 0
let pool: typeof import("../../shared/config").pool | undefined
let redis: typeof import("../../shared/config").redis | undefined
let closeAdminSessionStore: (() => void) | undefined

before(async () => {
    Object.assign(process.env, {
        NODE_ENV: "production",
        REDIS_URL: "redis://127.0.0.1:16389/3",
        PG_HOST: "127.0.0.1",
        PG_PORT: "16390",
        PG_USER: "playtime_test",
        PG_PASSWORD: "",
        PG_DATABASE: "playtime_test_admin_routes",
        JWT_SECRET_ENV: randomBytes(32).toString("hex"),
        SITE_ORIGIN: origin,
        CORS_ORIGIN: origin,
        ADMIN_ACCESS_KEY_HASH: fingerprint,
        ADMIN_SESSION_SIGNING_KEY: randomBytes(32).toString("hex"),
        ADMIN_IP_WHITELIST: legacyAllowedIp,
        TRUSTED_PROXY_IPS: "127.0.0.1,::1",
        RELEASE_REGISTER_SECRET: releaseSecret
    })
    siteDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "playtime-admin-routes-"))
    fs.writeFileSync(path.join(siteDirectory, "index.html"), `<html><body>${spaMarker}</body></html>`)
    process.env.SITE_DIST_PATH = siteDirectory
    const config = require("../../shared/config") as typeof import("../../shared/config")
    pool = config.pool
    redis = config.redis
    redis.on("error", () => {})
    mock.method(pool, "query", async () => {
        databaseCalls++
        throw new Error("Admin authorization must run before database access")
    })
    mock.method(pool, "connect", async () => {
        databaseCalls++
        throw new Error("Admin authorization must run before database access")
    })
    const { createLegacyApp } = require("../legacy/http") as typeof import("../legacy/http")
    ;({ closeAdminSessionStore } = require("../admin/adminSession") as typeof import("../admin/adminSession"))
    const { isAdminIpAllowed } = require("../../shared/http/clientIp") as typeof import("../../shared/http/clientIp")
    assert.equal(
        isAdminIpAllowed({
            socket: { remoteAddress: "127.0.0.1" },
            headers: { "x-real-ip": legacyAllowedIp }
        } as unknown as Request),
        true,
        "The test IP really passes the legacy whitelist"
    )
    server = createLegacyApp().listen(0, "127.0.0.1")
    await once(server, "listening")
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

after(async () => {
    closeAdminSessionStore?.()
    if (server) {
        server.closeAllConnections()
        await new Promise<void>((resolve) => server!.close(() => resolve()))
    }
    mock.restoreAll()
    await pool?.end()
    if (redis) await redis.quit().catch(() => redis?.disconnect())
    if (siteDirectory) fs.rmSync(siteDirectory, { recursive: true, force: true })
    assert.equal(databaseCalls, 0, "No unauthorized admin request may reach PostgreSQL")
})

const headers = { "X-Real-IP": legacyAllowedIp, "X-PlayTime-Admin": "1", Origin: origin }
const admin = (suffix: string, init: NonNullable<Parameters<typeof fetch>[1]> = {}) =>
    fetch(`${base}/playtime/admin/${suffix}`, {
        ...init,
        headers: { ...headers, ...init.headers }
    })

test("every mounted admin read API requires a cookie even from the legacy whitelisted IP", async () => {
    for (const endpoint of [
        "access",
        "stats",
        "health",
        "users",
        "me",
        "audit",
        "releases",
        "reports",
        "tickets",
        "visits"
    ]) {
        const response = await admin(endpoint, { headers: { Authorization: "Bearer legacy-account-token" } })
        assert.equal(response.status, 401, endpoint)
        assert.equal(response.headers.get("cache-control"), "no-store", endpoint)
        assert.equal((await response.json()).allowed, false, endpoint)
    }
})

test("every mounted admin write API requires a cookie despite valid Origin and custom header", async () => {
    for (const [method, endpoint] of [
        ["PUT", "users/1/subscription"],
        ["PATCH", "users/1/block"],
        ["PATCH", "releases/1"],
        ["PATCH", "reports/1"],
        ["PATCH", "tickets/1"]
    ]) {
        const response = await admin(endpoint, {
            method,
            headers: { "Content-Type": "application/json" },
            body: "{}"
        })
        assert.equal(response.status, 401, `${method} ${endpoint}`)
        assert.equal((await response.json()).allowed, false)
    }
})

test("cross-site admin writes are denied before session lookup or mutation", async () => {
    const response = await admin("tickets/1", {
        method: "PATCH",
        headers: {
            Origin: "https://untrusted.example.test",
            "Sec-Fetch-Site": "cross-site",
            "Content-Type": "application/json",
            Cookie: `pt_admin_session_v1=${Buffer.alloc(32, 9).toString("base64url")}`
        },
        body: "{}"
    })
    assert.equal(response.status, 403)
    assert.equal((await response.json()).allowed, false)
})

test("unsupported session GET never becomes a successful SPA response", async () => {
    const response = await admin("session", { headers: { Accept: "text/html" } })
    assert.ok([404, 405].includes(response.status), "Unsupported session methods must not return SPA success")
    const body = await response.text()
    assert.equal(body.includes(spaMarker), false)
    if (response.status === 405) {
        assert.match(response.headers.get("content-type") || "", /application\/json/)
        assert.match(response.headers.get("allow") || "", /POST/)
        assert.match(response.headers.get("allow") || "", /DELETE/)
        assert.equal(typeof JSON.parse(body).error, "string")
    }
})

test("missing or malformed configuration fails closed without falling back to the legacy IP", async () => {
    try {
        for (const value of [undefined, "not-a-key-hash"]) {
            if (value === undefined) delete process.env.ADMIN_ACCESS_KEY_HASH
            else process.env.ADMIN_ACCESS_KEY_HASH = value
            const response = await admin("access")
            assert.equal(response.status, 503)
            assert.equal((await response.json()).allowed, false)
        }
    } finally {
        process.env.ADMIN_ACCESS_KEY_HASH = fingerprint
    }
})

test("release registration keeps its separate machine secret and cannot use the old IP gate", async () => {
    for (const machineSecret of [undefined, "incorrect-machine-secret"]) {
        const response = await admin("releases/register", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(machineSecret ? { "X-Release-Register-Secret": machineSecret } : {})
            },
            body: "{}"
        })
        assert.equal(response.status, 403)
        await response.text()
    }
    const validMachineAuth = await admin("releases/register", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Release-Register-Secret": releaseSecret },
        body: "{}"
    })
    assert.equal(validMachineAuth.status, 400, "Machine auth reaches payload validation without a browser cookie")
    assert.equal((await validMachineAuth.json()).error, "Invalid payload")
})

test("release registration rate limits one client without exhausting another client's budget", async () => {
    const register = (clientIp: string) => admin("releases/register", {
        method: "POST",
        headers: { "X-Real-IP": clientIp, "Content-Type": "application/json", "X-Release-Register-Secret": releaseSecret },
        body: "{}"
    })
    for (let attempt = 0; attempt < 30; attempt++) {
        const response = await register("198.51.100.11")
        assert.equal(response.status, 400)
        await response.body?.cancel()
    }
    assert.equal((await register("198.51.100.11")).status, 429)
    assert.equal((await register("198.51.100.12")).status, 400)
})

test("public plan catalog stays accessible without an admin session", async () => {
    const response = await fetch(`${base}/playtime/subscription/plans`)
    assert.equal(response.status, 200)
    assert.ok(Array.isArray((await response.json()).plans))
})
