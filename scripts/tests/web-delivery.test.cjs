const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { createRequire } = require("node:module")
const { once } = require("node:events")
require("tsx/cjs")
const backendRequire = createRequire(path.resolve(__dirname, "../../apps/package.json"))
const express = backendRequire("express")
const helmet = backendRequire("helmet")
const { attachMarketingSite } = require("../../apps/gateway/http/serveSite.ts")

async function fixture(run, { missing = false } = {}) {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "playtime-web-routing-"))
    const previous = { SITE_DIST_PATH: process.env.SITE_DIST_PATH, WEB_DIST_PATH: process.env.WEB_DIST_PATH, NODE_ENV: process.env.NODE_ENV }
    let server
    try {
        await fs.writeFile(path.join(folder, "index.html"), "<!doctype html><title>marketing-fixture</title>")
        if (!missing) {
            await fs.mkdir(path.join(folder, "app", "assets"), { recursive: true })
            await fs.writeFile(path.join(folder, "app", "index.html"), "<!doctype html><title>web-app-fixture</title>")
            await fs.writeFile(path.join(folder, "app", "assets", "app.js"), "window.appLoaded = true;")
        }
        process.env.SITE_DIST_PATH = folder
        process.env.WEB_DIST_PATH = path.join(folder, "app")
        process.env.NODE_ENV = "production"
        const app = express()
        app.use(helmet())
        app.get("/playtime/auth/tokenValid", (_req, res) => res.json({ valid: true }))
        assert.equal(attachMarketingSite(app), true)
        server = app.listen(0, "127.0.0.1")
        await once(server, "listening")
        await run(`http://127.0.0.1:${server.address().port}`)
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
        if (server) {
            server.closeAllConnections()
            await new Promise(resolve => server.close(resolve))
        }
        await fs.rm(folder, { recursive: true, force: true })
    }
}

test("web bundle is distinct from landing, retains CSP and never caches the HTML entry", async () => fixture(async base => {
    const redirect = await fetch(`${base}/playtime/app?source=landing`, { redirect: "manual" })
    assert.equal(redirect.status, 301)
    assert.equal(redirect.headers.get("location"), "/playtime/app/?source=landing")
    for (const suffix of ["/", "/index.html"]) {
        const response = await fetch(`${base}/playtime/app${suffix}`)
        assert.equal(response.status, 200)
        assert.match(await response.text(), /web-app-fixture/)
        assert.equal(response.headers.get("cache-control"), "no-cache")
        assert.match(response.headers.get("content-security-policy"), /script-src 'self' 'wasm-unsafe-eval'/)
        assert.doesNotMatch(response.headers.get("content-security-policy"), /script-src[^;]*'unsafe-inline'/)
        assert.match(response.headers.get("content-security-policy"), /(?:^|; )img-src 'self' data: blob:(?:;|$)/)
        assert.match(response.headers.get("content-security-policy"), /(?:^|; )frame-ancestors 'none'(?:;|$)/)
    }
    const asset = await fetch(`${base}/playtime/app/assets/app.js`)
    assert.equal(asset.status, 200)
    assert.match(asset.headers.get("content-type"), /javascript/)
    assert.match(asset.headers.get("cache-control"), /max-age=86400/)
    assert.match(await (await fetch(`${base}/playtime/`)).text(), /marketing-fixture/)
    assert.deepEqual(await (await fetch(`${base}/playtime/auth/tokenValid`)).json(), { valid: true })
    for (const missing of ["assets/missing.js", "electron.js", "unknown"]) {
        const response = await fetch(`${base}/playtime/app/${missing}`)
        assert.equal(response.status, 404)
        assert.doesNotMatch(await response.text(), /marketing-fixture|web-app-fixture/)
    }
}))

test("a missing web build gives an explicit unavailable response rather than landing HTML", async () => fixture(async base => {
    const response = await fetch(`${base}/playtime/app/`)
    assert.equal(response.status, 503)
    assert.match(await response.text(), /Веб-версия временно недоступна/)
    assert.equal((await fetch(`${base}/playtime/`)).status, 200)
}, { missing: true }))
