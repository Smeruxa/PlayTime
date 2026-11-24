const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { createRequire } = require("node:module")
const { once } = require("node:events")
require("tsx/cjs")
const express = createRequire(path.resolve(__dirname, "../../apps/package.json"))("express")
const { attachMarketingSite, isPlaytimeApiPath } = require("../../apps/gateway/http/serveSite.ts")

test("feedback and admin screen paths remain distinct from API paths", () => {
    for (const url of ["/playtime/feedback", "/playtime/admin/requests"]) assert.equal(isPlaytimeApiPath(url), false)
    for (const url of [
        "/playtime/feedback-api/missing",
        "/playtime/site-analytics/visit",
        "/playtime/admin/visits",
        "/playtime/admin/session",
        "/playtime/admin/tickets",
        "/playtime/admin/tickets/42",
        "/playtime/admin/reports"
    ])
        assert.equal(isPlaytimeApiPath(url), true)
})
test("SPA fallback serves screens but does not turn missing APIs into successful HTML responses", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "playtime-site-routing-")),
        previous = process.env.SITE_DIST_PATH
    let server
    try {
        await fs.writeFile(path.join(folder, "index.html"), "<!doctype html><title>isolated-site-fixture</title>")
        process.env.SITE_DIST_PATH = folder
        const app = express()
        assert.equal(attachMarketingSite(app), true)
        server = app.listen(0, "127.0.0.1")
        await once(server, "listening")
        const base = `http://127.0.0.1:${server.address().port}`
        for (const screen of ["feedback", "admin/requests"]) {
            const response = await fetch(`${base}/playtime/${screen}`)
            assert.equal(response.status, 200)
            assert.match(await response.text(), /isolated-site-fixture/)
        }
        for (const api of ["feedback-api/missing?test=1", "site-analytics/visit", "admin/session", "admin/visits", "admin/tickets/42", "admin/reports"])
            assert.equal((await fetch(`${base}/playtime/${api}`)).status, 404)
    } finally {
        if (previous === undefined) delete process.env.SITE_DIST_PATH
        else process.env.SITE_DIST_PATH = previous
        if (server) {
            server.closeAllConnections()
            await new Promise((resolve) => server.close(resolve))
        }
        await fs.rm(folder, { recursive: true, force: true })
    }
})
