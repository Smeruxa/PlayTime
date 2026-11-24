const assert = require("node:assert/strict")
const path = require("node:path")
const engine = process.env.WEB_BROWSER_ENGINE || "chromium"
const browserType = require(process.env.PLAYWRIGHT_MODULE || "playwright")[engine]
let server, browser
;(async () => {
    const { createServer } = await import("vite")
    server = await createServer({
        root: path.resolve(__dirname, "../../apps/frontend"),
        configFile: false,
        server: { host: "127.0.0.1", port: 4187, strictPort: true, open: false, watch: null },
        plugins: [{ name: "isolated-key-vault", configureServer(vite) {
            vite.middlewares.use("/__key-vault", (_req, response) => {
                response.setHeader("Content-Type", "text/html")
                response.end('<!doctype html><html><head><title>Key vault test</title></head><body><script type="module">import * as vault from "/src/features/chat/keyVault.ts"; import * as dm from "/src/features/chat/dmE2ee.ts"; window.keyQa = { vault, dm };</script></body></html>')
            })
        } }]
    })
    await server.listen()
    browser = await browserType.launch({ headless: true, ...(process.env.WEB_BROWSER_PATH ? { executablePath: process.env.WEB_BROWSER_PATH } : {}) })
    const context = await browser.newContext()
    const errors = []
    const tab = async () => {
        const page = await context.newPage()
        page.on("pageerror", error => errors.push(error.message))
        await page.goto("http://127.0.0.1:4187/__key-vault")
        await page.waitForFunction(() => !!window.keyQa)
        return page
    }
    const [first, second, third] = await Promise.all([tab(), tab(), tab()])
    await Promise.all([first, second].map(page => page.evaluate(() => window.keyQa.vault.hydrateKeys(4242))))
    const publicKeys = await Promise.all([first, second].map(page => page.evaluate(() => window.keyQa.dm.ensureDmKeyPair(4242))))
    assert.equal(publicKeys[0], publicKeys[1], "two tabs must retain the same DM identity")
    await Promise.all([
        first.evaluate(() => window.keyQa.vault.writeSecret("room:1", "fixture-room-one", 4242)),
        second.evaluate(() => window.keyQa.vault.writeSecret("room:2", "fixture-room-two", 4242))
    ])
    const roomNames = await second.evaluate(async () => {
        await window.keyQa.vault.hydrateKeys(4242)
        return Object.keys(window.keyQa.vault.snapshotKeys(4242)).sort()
    })
    assert.deepEqual(roomNames, ["dm", "room:1", "room:2"])
    const encrypted = await first.evaluate(() => {
        const { dm } = window.keyQa
        return dm.encryptDmPlaintext("Сохранённая переписка", dm.getDmPublicKeyB64(4242), dm.getDmSecretKey(4242))
    })
    await first.close()
    const reopened = await tab()
    const readable = await reopened.evaluate(async ciphertext => {
        const { vault, dm } = window.keyQa
        await vault.hydrateKeys(4242)
        const pub = dm.getDmPublicKeyB64(4242)
        return dm.decryptDmCiphertext(ciphertext, dm.getDmSecretKey(4242), pub, pub, true)
    }, encrypted)
    assert.equal(readable, "Сохранённая переписка", "closing the winning tab must not lose decryption keys")
    await second.evaluate(() => window.keyQa.vault.writeSecret("room:1", null, 4242))
    await reopened.waitForFunction(() => !window.keyQa.vault.readSecret("room:1", 4242))
    assert.deepEqual(await reopened.evaluate(() => Object.keys(window.keyQa.vault.snapshotKeys(4242)).sort()), ["dm", "room:2"])

    const writers = [second, third, reopened]
    const stressRounds = 5, writesPerTab = 200
    for (let round = 0; round < stressRounds; round++) {
        const userId = 5000 + round
        await Promise.all(writers.map(page => page.evaluate(userId => window.keyQa.vault.hydrateKeys(userId), userId)))
        await Promise.all(writers.map((page, index) => page.evaluate(async ({ userId, index, count }) => {
            for (let key = 0; key < count; key++)
                await window.keyQa.vault.writeSecret(`room:${index}:${key}`, `fixture-${index}-${key}`, userId)
        }, { userId, index, count: writesPerTab })))
        const observer = await tab()
        const durable = await observer.evaluate(async userId => {
            await window.keyQa.vault.hydrateKeys(userId)
            return window.keyQa.vault.snapshotKeys(userId)
        }, userId)
        const expected = Object.fromEntries(writers.flatMap((_, index) =>
            Array.from({ length: writesPerTab }, (_, key) => [`room:${index}:${key}`, `fixture-${index}-${key}`])))
        assert.deepEqual(durable, expected, `all ${writers.length * writesPerTab} keys must survive round ${round}`)
        await observer.close()
    }

    const migration = await second.evaluate(async () => {
        const vault = window.keyQa.vault
        localStorage.setItem("playtime_keys_dev:6100", JSON.stringify({ dm: "legacy-dm", "room:1": "legacy-room" }))
        await vault.hydrateKeys(6100)
        const imported = vault.snapshotKeys(6100)
        await vault.replaceKeys(6100, {})
        localStorage.setItem("playtime_keys_dev:6100", JSON.stringify({ dm: "stale-dm" }))
        localStorage.setItem("playtime_dm_secret_key_b64:6100", "stale-dm")
        localStorage.setItem("playtime_room_sym_b64_1", "stale-room")
        await vault.hydrateKeys(6100)
        await vault.migrateRoomKeys([1])
        const afterEmptyRestore = vault.snapshotKeys(6100)
        await vault.hydrateKeys(6101)
        await vault.writeSecret("room:2", null, 6101)
        localStorage.setItem("playtime_room_sym_b64_2", "stale-room")
        await vault.migrateRoomKeys([2])
        return { imported, afterEmptyRestore, deletedRoom: vault.readSecret("room:2", 6101), legacyAllowed: vault.canReadLegacyRoomKey(2) }
    })
    assert.deepEqual(migration, { imported: { dm: "legacy-dm", "room:1": "legacy-room" }, afterEmptyRestore: {}, deletedRoom: null, legacyAllowed: false })

    const retry = await second.evaluate(async () => {
        const vault = window.keyQa.vault
        localStorage.setItem("playtime_dm_secret_key_b64:6102", "fixture-retry-dm")
        const original = IDBObjectStore.prototype.put
        IDBObjectStore.prototype.put = function () { throw new DOMException("Simulated quota failure", "QuotaExceededError") }
        let rejected = false
        try { await vault.hydrateKeys(6102) } catch { rejected = true }
        finally { IDBObjectStore.prototype.put = original }
        const preserved = localStorage.getItem("playtime_dm_secret_key_b64:6102")
        const beforeRetry = vault.readSecret("dm", 6102)
        await vault.hydrateKeys(6102)
        return { rejected, preserved, beforeRetry, afterRetry: vault.readSecret("dm", 6102) }
    })
    assert.deepEqual(retry, { rejected: true, preserved: "fixture-retry-dm", beforeRetry: null, afterRetry: "fixture-retry-dm" })
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ passed: true, engine, concurrentWriters: 3, stressWrites: stressRounds * writesPerTab * writers.length, checks: ["atomic DM initialization", "room-key merge", "decrypt after reopening", "cross-tab deletion", "durable concurrent writes", "one-time migration", "empty restore and room tombstones", "commit failure preserves migration source"], errors }))
})().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
    await browser?.close()
    await server?.close()
})
