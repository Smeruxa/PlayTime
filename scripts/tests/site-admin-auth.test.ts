import assert from "node:assert/strict"
import test from "node:test"
import {
    AdminAccessError,
    checkAdminAccess,
    createAdminLoginCommand,
    endAdminSession
} from "../../apps/site/src/auth/adminLogin"

test("admin access checks the same-origin cookie session without a key or account token", async () => {
    const calls: { url: string; options?: RequestInit }[] = []
    const request = (async (url: string, options?: RequestInit) => {
        calls.push({ url, options })
        return Response.json({ allowed: true, clientIp: "192.0.2.10" })
    }) as typeof fetch
    const signal = new AbortController().signal
    assert.deepEqual(await checkAdminAccess("/playtime", signal, request), { clientIp: "192.0.2.10" })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, "/playtime/admin/access")
    assert.equal(calls[0].options?.body, undefined)
    assert.equal(calls[0].options?.headers, undefined)
    assert.equal(calls[0].options?.signal, signal)
    assert.equal(calls[0].options?.credentials, "same-origin")
})
test("missing session and denied origin produce distinct access failures", async () => {
    for (const [status, reason] of [
        [401, "unauthenticated"],
        [403, "denied"]
    ] as const) {
        await assert.rejects(
            checkAdminAccess("/playtime", new AbortController().signal, (async () =>
                Response.json({ allowed: false }, { status })) as typeof fetch),
            (error) => error instanceof AdminAccessError && error.reason === reason
        )
    }
})
test("unavailable server and missing authorization cannot authorize an admin", async () => {
    for (const response of [
        Response.json({ allowed: false }, { status: 403 }),
        Response.json({}, { status: 503 }),
        Response.json({})
    ]) {
        await assert.rejects(
            checkAdminAccess("/playtime", new AbortController().signal, (async () => response) as typeof fetch)
        )
    }
})

test("logout waits for a same-origin DELETE before completing and propagates failures", async () => {
    const calls: { url: string; options?: RequestInit }[] = []
    await endAdminSession("/playtime", (async (url: string, options?: RequestInit) => {
        calls.push({ url, options })
        return new Response(null, { status: 204 })
    }) as typeof fetch)
    assert.equal(calls[0].url, "/playtime/admin/session")
    assert.equal(calls[0].options?.method, "DELETE")
    assert.equal(calls[0].options?.credentials, "same-origin")
    assert.deepEqual(calls[0].options?.headers, { "X-PlayTime-Admin": "1" })
    assert.equal(calls[0].options?.body, undefined)
    await assert.rejects(endAdminSession("/playtime", (async () => Response.json({}, { status: 503 })) as typeof fetch))
    await endAdminSession("/playtime", (async () => Response.json({}, { status: 401 })) as typeof fetch)
})

test("the console command prompts for a key and never embeds or persists it", async () => {
    const command = createAdminLoginCommand("/playtime", "/playtime/admin/panel")
    assert.match(command, /prompt\("Ключ администратора PlayTime"\)/)
    assert.doesNotMatch(command, /localStorage|sessionStorage|console\./)
    const calls: RequestInit[] = [],
        navigations: string[] = []
    const fixtureKey = "unit-fixture-not-a-real-credential"
    const run = new Function("location", "prompt", "fetch", `return ${command}`)
    await run(
        { origin: "https://example.test", assign: (url: string) => navigations.push(url) },
        () => fixtureKey,
        async (_url: URL, options: RequestInit) => {
            calls.push(options)
            return Response.json({ allowed: true })
        }
    )
    assert.equal(calls[0].method, "POST")
    assert.equal(calls[0].credentials, "same-origin")
    assert.deepEqual(calls[0].headers, { "Content-Type": "application/json", "X-PlayTime-Admin": "1" })
    assert.deepEqual(JSON.parse(calls[0].body as string), { key: fixtureKey })
    assert.deepEqual(navigations, ["/playtime/admin/panel"])
    assert.equal(command.includes(fixtureKey), false)
})

test("the console command rejects a cross-origin endpoint before prompting", async () => {
    let prompted = false
    const run = new Function(
        "location",
        "prompt",
        "fetch",
        `return ${createAdminLoginCommand("https://other.test/playtime", "/playtime/admin/panel")}`
    )
    await assert.rejects(
        run(
            { origin: "https://example.test" },
            () => {
                prompted = true
            },
            () => {
                throw new Error("Request must not be sent")
            }
        )
    )
    assert.equal(prompted, false)
})
