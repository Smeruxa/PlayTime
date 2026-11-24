const assert = require("node:assert/strict")
const { once } = require("node:events")
const { test } = require("node:test")
const { mkdtemp, rm, writeFile } = require("node:fs/promises")
const { tmpdir } = require("node:os")
const path = require("node:path")
const { loadAuthModules } = require("../fixtures/auth-module-loader.cjs")

test("release uploads require an explicit account and pinned host keys", async (t) => {
    require("tsx/cjs")
    const { releaseSshTarget } = require("../lib/release.ts")
    const root = await mkdtemp(path.join(tmpdir(), "playtime-release-security-"))
    t.after(() => rm(root, { recursive: true, force: true }))
    const credentials = { DEPLOY_HOST: "release.example.test", DEPLOY_SSH_KEY: "key" }
    assert.throws(() => releaseSshTarget(credentials, root), /DEPLOY_USER/)
    const account = { ...credentials, DEPLOY_USER: "publisher" }
    assert.throws(() => releaseSshTarget(account, root), /DEPLOY_KNOWN_HOSTS/)
    const pinned = { ...account, DEPLOY_KNOWN_HOSTS: "pinned keys" }
    assert.throws(() => releaseSshTarget(pinned, root), /local known_hosts file/)
    const pinnedFile = path.join(root, "pinned keys")
    await writeFile(pinnedFile, "pinned host-key fixture\n", { mode: 0o600 })
    const { user, sshOpts } = releaseSshTarget(pinned, root)
    assert.equal(user, "publisher")
    assert.ok(sshOpts.includes("StrictHostKeyChecking=yes"))
    assert.ok(sshOpts.includes(`UserKnownHostsFile="${pinnedFile}"`))
    assert.ok(sshOpts.includes("GlobalKnownHostsFile=none"))
    assert.ok(!sshOpts.some((option) => option.includes("accept-new")))
})

test("Windows feeds retire without hiding manual downloads or the macOS updater", async (t) => {
    const load = loadAuthModules({ "apps/shared/config.ts": {} })
    const service = load("apps/gateway/releases/releaseService.ts")
    const windows = { platform: "win32", version: "2.0.21", url: "/playtime/downloads/win32/test.exe" }
    const feeds = []
    service.getLatestPublishedMap = async () => ({ win32: windows })
    service.buildFeedForPlatform = async (platform) => {
        feeds.push(platform)
        return "version: 2.0.21\n"
    }
    const { createRequire } = require("node:module")
    const backendRequire = createRequire(require.resolve("../../apps/package.json"))
    const app = backendRequire("express")()
    app.use("/playtime/releases", load("apps/gateway/routes/releases.ts").default)
    const server = app.listen(0, "127.0.0.1")
    t.after(() => new Promise((resolve) => server.close(resolve)))
    await once(server, "listening")
    const base = `http://127.0.0.1:${server.address().port}/playtime/releases`

    for (const suffix of ["win", "windows", "win32", "win32/latest.yml"]) {
        const response = await fetch(`${base}/feed/${suffix}`)
        assert.equal(response.status, 410)
        assert.equal(response.headers.get("cache-control"), "no-store")
    }
    const catalog = await fetch(`${base}/latest`)
    assert.equal(catalog.status, 200)
    assert.deepEqual((await catalog.json()).releases.win32, windows)
    const mac = await fetch(`${base}/feed/darwin/latest-mac.yml`)
    assert.equal(mac.status, 200)
    assert.equal(await mac.text(), "version: 2.0.21\n")
    assert.deepEqual(feeds, ["darwin"])
})
