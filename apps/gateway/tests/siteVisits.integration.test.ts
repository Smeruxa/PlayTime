import { resolve } from "node:path"
import assert from "node:assert/strict"
import { after, before, beforeEach, test, mock } from "node:test"
import { once } from "node:events"
import fs from "node:fs"
import express from "express"
import type { Server } from "node:http"
import { pool, redis } from "../../shared/config"
import { runPendingMigrations } from "../../database/runMigrations"
import { siteAnalyticsAdminRouter, siteAnalyticsRouter } from "../routes/siteAnalytics"
import { cleanupSiteVisitSessions, getSiteVisitStats, visitSessionHash } from "../analytics/siteVisits"
import { adminSessionRouter } from "../routes/adminSession"
import { closeAdminFixture, configureAdminFixture, loginAdminFixture } from "./adminFixture"

let server: Server, base: string, adminCookie: string
const origin = "https://site.example.test"
const ip = "192.0.2.2"
const id = "a".repeat(32)
before(async () => {
    if (
        process.env.PG_DATABASE !== "playtime_test_site_visits" ||
        process.env.PG_PORT !== "16390" ||
        process.env.REDIS_URL !== "redis://127.0.0.1:16389"
    )
        throw new Error("Use the dedicated ephemeral site visit databases")
    process.env.SITE_ORIGIN = origin
    await pool.query(fs.readFileSync(resolve(__dirname, "../../database/schema.sql"), "utf8"))
    await runPendingMigrations()
    configureAdminFixture()
    const app = express()
    app.use("/site-analytics", siteAnalyticsRouter)
    app.use("/admin", adminSessionRouter)
    app.use("/admin/visits", siteAnalyticsAdminRouter)
    server = app.listen(0, "127.0.0.1")
    await once(server, "listening")
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
beforeEach(async () => {
    await pool.query("DELETE FROM site_visit_days")
    await pool.query("DELETE FROM site_visit_sessions")
    await redis.flushdb()
    adminCookie = await loginAdminFixture(base)
})
after(async () => {
    closeAdminFixture()
    if (server) {
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    await pool.end()
    await redis.quit()
})

const send = (body: unknown = { sessionId: id, page: "landing" }, headers: Record<string, string> = {}) =>
    fetch(`${base}/site-analytics/visit`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json", "X-Real-IP": ip, ...headers },
        body: JSON.stringify(body)
    })
const stats = async (headers: Record<string, string> = {}) =>
    fetch(`${base}/admin/visits`, {
        headers: { "X-Real-IP": "192.0.2.1", Cookie: adminCookie, ...headers }
    })
const total = async () =>
    Number((await pool.query("SELECT COALESCE(SUM(visits),0) AS n FROM site_visit_days")).rows[0].n)

test("empty stats expose zero with actual enabled date and require an admin session despite IP spoofing", async () => {
    assert.equal((await stats({ Cookie: "", "X-Real-IP": ip, "X-Forwarded-For": "192.0.2.1" })).status, 401)
    const response = await stats()
    assert.equal(response.headers.get("cache-control"), "no-store")
    const { visits } = await response.json()
    assert.deepEqual([visits.today, visits.week, visits.total], [0, 0, 0])
    assert.equal(visits.timeZone, "Europe/Moscow")
    assert.equal(visits.sessionMinutes, 30)
    const enabled = (await pool.query("SELECT enabled_at FROM site_visit_settings WHERE id=1")).rows[0].enabled_at
    assert.equal(visits.enabledAt, enabled.toISOString())
})

test("concurrent tabs, reloads and page navigation atomically count once, including Redis loss", async () => {
    const responses = await Promise.all(Array.from({ length: 20 }, () => send()))
    assert.ok(responses.every((response) => response.status === 204))
    assert.equal(await total(), 1)
    await redis.flushdb()
    for (const page of ["feedback", "privacy", "terms", "landing"]) {
        assert.equal((await send({ sessionId: id, page })).status, 204)
    }
    assert.equal(await total(), 1)
    const sessions = (await pool.query("SELECT * FROM site_visit_sessions")).rows
    assert.equal(sessions.length, 1)
    assert.equal(sessions[0].session_hash, visitSessionHash(id))
    assert.ok(sessions[0].expires_at.getTime() > Date.now() + 29 * 60 * 1000)
    assert.equal(JSON.stringify(sessions).includes(ip), false)
    assert.equal(JSON.stringify(sessions).includes(id), false)
})

test("server expiry creates a new visit and expired anonymous keys are pruned", async () => {
    await send()
    await pool.query("UPDATE site_visit_sessions SET expires_at=clock_timestamp()-INTERVAL '1 second'")
    await send()
    assert.equal(await total(), 2)
    await pool.query("UPDATE site_visit_sessions SET expires_at=clock_timestamp()-INTERVAL '1 second'")
    await cleanupSiteVisitSessions()
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM site_visit_sessions")).rows[0].n, 0)
    assert.equal(await total(), 2)
})

test("daily Moscow calendar buckets include today plus six days, with no fabricated history", async () => {
    await pool.query(`
        INSERT INTO site_visit_days(day,visits) VALUES
            ((NOW() AT TIME ZONE 'Europe/Moscow')::date,3),
            ((NOW() AT TIME ZONE 'Europe/Moscow')::date-1,5),
            ((NOW() AT TIME ZONE 'Europe/Moscow')::date-6,7),
            ((NOW() AT TIME ZONE 'Europe/Moscow')::date-7,11)
    `)
    const { visits } = await (await stats()).json()
    assert.deepEqual([visits.today, visits.week, visits.total], [3, 15, 26])
})

test("Moscow midnight rolls day and seven-day window at 21:00 UTC", async () => {
    await pool.query(
        "INSERT INTO site_visit_days(day,visits) VALUES ('2026-11-03',3),('2026-11-04',5),('2026-10-28',7)"
    )
    const before = await getSiteVisitStats(new Date("2026-11-03T20:59:59.999Z"))
    const after = await getSiteVisitStats(new Date("2026-11-03T21:00:00.000Z"))
    assert.deepEqual([before.today, before.week], [3, 10])
    assert.deepEqual([after.today, after.week], [5, 8])
    assert.equal(before.total, after.total)
})

test("Origin, fetch metadata, JSON type, bounded body and allowed public page are required", async () => {
    const rejectedHeaders: Record<string, string>[] = [
        { Origin: "" },
        { Origin: "https://attacker.example.test", Host: "attacker.example.test" },
        { Origin: "https://site.example.test.attacker.example" },
        { "Sec-Fetch-Site": "cross-site" }
    ]
    for (const headers of rejectedHeaders) assert.equal((await send(undefined, headers)).status, 403)
    assert.equal((await send(undefined, { "Content-Type": "text/plain" })).status, 415)
    for (const body of [
        { sessionId: id, page: "admin" },
        { sessionId: id, page: "login" },
        { sessionId: "bad", page: "landing" },
        { sessionId: id, page: "landing", userAgent: "not-collected" },
        null,
        []
    ])
        assert.equal((await send(body)).status, 400)
    assert.equal((await send({ sessionId: id, page: "landing", extra: "x".repeat(300) })).status, 413)
    assert.equal(await total(), 0)
    assert.equal((await send(undefined, { Origin: "https://www.site.example.test" })).status, 204)
    assert.equal(await total(), 1)
})

test("atomic IP and global budgets reject bursts with Retry-After before any aggregate write", async () => {
    const responses = await Promise.all(Array.from({ length: 65 }, () => send({ sessionId: "bad", page: "landing" })))
    assert.equal(responses.filter((response) => response.status === 400).length, 60)
    assert.equal(responses.filter((response) => response.status === 429).length, 5)
    assert.ok(Number(responses.find((response) => response.status === 429)!.headers.get("retry-after")) > 0)
    await redis.set("site-visits:budget:global", "1200", "EX", 60)
    assert.equal((await send(undefined, { "X-Real-IP": "198.51.100.9" })).status, 429)
    assert.equal(await total(), 0)
    const keys = await redis.keys("site-visits:budget:*")
    assert.equal(
        keys.some((key) => key.includes(ip)),
        false
    )
})

test("failed aggregate transaction rolls back session; retry records exactly one additional visit", async () => {
    await send()
    await pool.query("ALTER TABLE site_visit_days ADD CONSTRAINT site_visits_test_max CHECK (visits <= 1)")
    try {
        assert.equal((await send({ sessionId: "b".repeat(32), page: "landing" })).status, 503)
        assert.equal(await total(), 1)
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM site_visit_sessions")).rows[0].n, 1)
    } finally {
        await pool.query("ALTER TABLE site_visit_days DROP CONSTRAINT site_visits_test_max")
    }
    assert.equal((await send({ sessionId: "b".repeat(32), page: "landing" })).status, 204)
    assert.equal(await total(), 2)
})

test("unavailable Redis never bypasses the public budget", async () => {
    const failure = mock.method(redis, "eval", async () => {
        throw new Error("isolated outage")
    })
    try {
        assert.equal((await send()).status, 503)
    } finally {
        failure.mock.restore()
    }
    assert.equal(await total(), 0)
})
