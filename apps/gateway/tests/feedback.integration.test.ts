import { resolve } from "node:path"
import assert from "node:assert/strict"
import { after, before, beforeEach, test, mock } from "node:test"
import { once } from "node:events"
import fs from "node:fs"
import express from "express"
import type { Server } from "node:http"
import { pool, redis } from "../../shared/config"
import { runPendingMigrations } from "../../database/runMigrations"
import router, { feedbackAdminRouter } from "../routes/feedback"
import { feedbackIpHash, issueFeedbackToken, verifyFeedbackToken } from "../feedback/abuse"
import { adminSessionRouter } from "../routes/adminSession"
import { ADMIN_TEST_ORIGIN, closeAdminFixture, configureAdminFixture, loginAdminFixture } from "./adminFixture"

let server: Server, base: string, adminCookie: string
before(async () => {
    if (
        process.env.PG_DATABASE !== "playtime_test_feedback" ||
        process.env.PG_PORT !== "16390" ||
        process.env.REDIS_URL !== "redis://127.0.0.1:16389"
    )
        throw new Error("Use the dedicated ephemeral feedback databases")
    await pool.query(fs.readFileSync(resolve(__dirname, "../../database/schema.sql"), "utf8"))
    await runPendingMigrations()
    configureAdminFixture()
    const app = express()
    app.use("/feedback-api", router)
    app.use("/admin", adminSessionRouter)
    app.use(express.json({ limit: "32kb" }))
    app.use("/admin/tickets", feedbackAdminRouter)
    server = app.listen(0, "127.0.0.1")
    await once(server, "listening")
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
beforeEach(async () => {
    await pool.query("DELETE FROM feedback_tickets")
    await pool.query("DELETE FROM admin_audit_log")
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
const ip = "192.0.2.2"
const payload = (address = ip) => ({
    kind: "feature",
    title: "Тихий режим для звонков",
    description: "Хочется отключать уведомления во время звонка с друзьями.",
    contact: "@example",
    platform: "macOS",
    appVersion: "2.0.11",
    website: "",
    token: issueFeedbackToken(feedbackIpHash(address), Date.now() - 4000)
})
const send = (body: unknown, address = ip, extra: Record<string, string> = {}) =>
    fetch(`${base}/feedback-api/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Real-IP": address, ...extra },
        body: JSON.stringify(body)
    })
const admin = (path = "", init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    fetch(`${base}/admin/tickets${path}`, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            "X-Real-IP": "192.0.2.1",
            "X-PlayTime-Admin": "1",
            Cookie: adminCookie,
            Origin: ADMIN_TEST_ORIGIN,
            ...init.headers
        }
    })

test("challenge signatures reject early, expired, tampered and other-IP submissions; IPv6 subnet budgets match", () => {
    const hash = feedbackIpHash(ip),
        now = Date.now(),
        token = issueFeedbackToken(hash, now)
    assert.equal(verifyFeedbackToken(token, hash, now + 2999), false)
    assert.equal(verifyFeedbackToken(token, hash, now + 3000), true)
    assert.equal(verifyFeedbackToken(token, hash, now + 1800001), false)
    assert.equal(verifyFeedbackToken(token, feedbackIpHash("192.0.2.3"), now + 4000), false)
    assert.equal(verifyFeedbackToken(token.slice(0, -1) + "x", hash, now + 4000), false)
    assert.equal(feedbackIpHash("2001:db8:abcd:1200::1"), feedbackIpHash("2001:db8:abcd:12ff::abcd"))
    assert.notEqual(feedbackIpHash("2001:db8:abcd:1200::1"), feedbackIpHash("2001:db8:abcd:1300::1"))
})
test("real challenge works and malformed, honeypot, oversize and invalid kinds never create tickets", async () => {
    const challenge = await fetch(`${base}/feedback-api/challenge`, { headers: { "X-Real-IP": ip } })
    assert.equal(challenge.status, 200)
    assert.equal(challenge.headers.get("cache-control"), "no-store")
    const token = (await challenge.json()).token
    assert.equal((await send({ ...payload(), token })).status, 400)
    for (const bad of [
        { title: "abc" },
        { kind: "admin" },
        { description: "short" },
        { website: "https://spam.test" },
        { token: "forged" },
        { contact: "a\u0000b" }
    ])
        assert.equal((await send({ ...payload(), ...bad })).status, 400)
    assert.equal((await send({ ...payload(), description: "я".repeat(13000) })).status, 413)
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM feedback_tickets")).rows[0].n, 0)
    assert.equal((await send({ ...payload(), description: "я".repeat(6000) })).status, 201)
})
test("parallel submissions create exactly one ticket and cooldown survives Redis loss and forwarding spoof", async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => send(payload())))
    assert.equal(responses.filter((r) => r.status === 201).length, 1)
    assert.equal(responses.filter((r) => r.status === 429).length, 7)
    await redis.flushdb()
    const blocked = await send(payload(), ip, { "X-Forwarded-For": "198.51.100.5" })
    assert.equal(blocked.status, 429)
    assert.ok(Number(blocked.headers.get("retry-after")) > 890)
    const rows = (await pool.query("SELECT * FROM feedback_tickets")).rows
    assert.equal(rows.length, 1)
    assert.match(rows[0].ip_hash, /^[a-f0-9]{64}$/)
    assert.equal(JSON.stringify(rows).includes(ip), false)
    assert.equal((await send(payload("192.0.2.3"), "192.0.2.3")).status, 201)
    await pool.query("UPDATE feedback_tickets SET created_at=NOW()-INTERVAL '16 minutes' WHERE ip_hash=$1", [
        feedbackIpHash(ip)
    ])
    assert.equal((await send(payload())).status, 201)
})
test("atomic per-IP and global request budgets cap traffic and return Retry-After", async () => {
    const results = await Promise.all(
        Array.from({ length: 35 }, () => fetch(`${base}/feedback-api/challenge`, { headers: { "X-Real-IP": ip } }))
    )
    assert.equal(results.filter((r) => r.status === 200).length, 30)
    assert.equal(results.filter((r) => r.status === 429).length, 5)
    await redis.flushdb()
    const distributed = await Promise.all(
        Array.from({ length: 125 }, (_, i) =>
            fetch(`${base}/feedback-api/challenge`, { headers: { "X-Real-IP": `198.51.100.${i + 1}` } })
        )
    )
    assert.equal(distributed.filter((r) => r.status === 200).length, 120)
    assert.equal(distributed.filter((r) => r.status === 429).length, 5)
    assert.ok(Number(distributed.find((r) => r.status === 429)!.headers.get("retry-after")) > 0)
})
test("Redis failure closes intake instead of bypassing abuse checks", async () => {
    const failure = mock.method(redis, "eval", async () => {
        throw new Error("test outage")
    })
    try {
        assert.equal((await send(payload())).status, 503)
    } finally {
        failure.mock.restore()
    }
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM feedback_tickets")).rows[0].n, 0)
})
test("admin access, filters, literal search, pagination, revision checks and audit are enforced", async () => {
    assert.equal((await fetch(`${base}/admin/tickets`, { headers: { "X-Real-IP": ip } })).status, 401)
    assert.equal((await send(payload())).status, 201)
    const ticket = (await (await admin()).json()).tickets[0]
    assert.equal("ip_hash" in ticket, false)
    const mutation = {
        status: "in_progress",
        priority: "high",
        internalNote: "Проверить на macOS",
        revision: ticket.revision
    }
    assert.equal(
        (
            await admin(`/${ticket.id}`, {
                method: "PATCH",
                headers: { "X-PlayTime-Admin": "" },
                body: JSON.stringify(mutation)
            })
        ).status,
        403
    )
    const updated = await admin(`/${ticket.id}`, { method: "PATCH", body: JSON.stringify(mutation) })
    assert.equal(updated.status, 200)
    assert.equal((await updated.json()).ticket.revision, 2)
    assert.equal((await admin(`/${ticket.id}`, { method: "PATCH", body: JSON.stringify(mutation) })).status, 409)
    assert.equal(
        (await (await admin("?status=in_progress&priority=high&kind=feature&search=звонков")).json()).tickets.length,
        1
    )
    assert.equal((await (await admin("?kind=bug")).json()).tickets.length, 0)
    assert.equal((await (await admin("?search=%25_'")).json()).tickets.length, 0)
    assert.equal((await admin("?status=invalid")).status, 400)
    await pool.query(
        "INSERT INTO feedback_tickets(kind,title,description,ip_hash) SELECT 'bug','Ошибка '||n,'Тестовая ошибка воспроизводится', $1 FROM generate_series(1,35) n",
        [feedbackIpHash("192.0.2.99")]
    )
    const first = await (await admin()).json(),
        second = await (await admin(`?before=${first.nextCursor}`)).json()
    assert.equal(first.tickets.length, 30)
    assert.equal(second.tickets.length, 6)
    assert.equal(
        first.tickets.some((row: { id: string }) =>
            second.tickets.some((other: { id: string }) => other.id === row.id)
        ),
        false
    )
    const audit = (await pool.query("SELECT * FROM admin_audit_log")).rows
    assert.equal(audit.length, 1)
    assert.equal(audit[0].action, "ticket.update")
    assert.equal(JSON.stringify(audit).includes(mutation.internalNote), false)
})
