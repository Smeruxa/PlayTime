import test from "node:test"
import assert from "node:assert/strict"
import { PushDispatcher, type PushQueue } from "../../apps/gateway/push/dispatcher"
import { parsePushRegistration } from "../../apps/gateway/push/validation"
import { pushMessage, RuStorePushSender } from "../../apps/gateway/push/rustore"
import type { PushDelivery, PushResult } from "../../apps/gateway/push/types"
import type { PushRequest } from "../../apps/gateway/push/httpRequest"

function delivery(overrides: Partial<PushDelivery> = {}): PushDelivery {
    return {
        id: "101",
        deviceId: "device-101",
        token: "local-test-device-token",
        eventKey: "m:11",
        target: { version: 1, userId: 2, kind: "chat", id: 1, isRoom: false, name: "sender" },
        title: "sender",
        messageId: 11,
        callRoomId: null,
        expiresAt: Date.now() + 60_000,
        attempts: 1,
        ...overrides
    }
}

function queueFixture(items: PushDelivery[], allowed = true) {
    const completed: string[] = [],
        invalidated: string[] = [],
        retries: Array<[string, number]> = []
    const queue: PushQueue = {
        claim: async () => items.splice(0),
        allowed: async () => allowed,
        complete: async (id) => {
            completed.push(id)
        },
        invalidate: async (id, token) => {
            invalidated.push(`${id}:${token}`)
        },
        retry: async (id, delay) => {
            retries.push([id, delay])
        }
    }
    return { queue, completed, invalidated, retries }
}

test("push registration accepts only bounded opaque tokens and valid unique mute keys", () => {
    const valid = {
        provider: "rustore",
        token: "test-token-123",
        enabled: true,
        mutedChats: ["dm:sender", "room:12", "dm:sender"]
    }
    assert.deepEqual(parsePushRegistration(valid)?.mutedChats, ["dm:sender", "room:12"])
    for (const input of [
        null,
        {},
        { ...valid, provider: "other" },
        { ...valid, token: "tiny" },
        { ...valid, token: "x".repeat(4097) },
        { ...valid, token: "test\ntoken" },
        { ...valid, enabled: "yes" },
        { ...valid, mutedChats: ["room:-1"] },
        { ...valid, mutedChats: ["dm:bad name"] },
        { ...valid, mutedChats: new Array(501).fill("room:1") }
    ]) {
        assert.equal(parsePushRegistration(input), null)
    }
})

test("mute keys reject every C0 control while retaining Unicode length and legacy DEL boundaries", () => {
    const parse = (key: string) =>
        parsePushRegistration({
            provider: "rustore",
            token: "test-token-123",
            enabled: true,
            mutedChats: [key]
        })
    for (let code = 0; code < 32; code++) {
        assert.equal(parse(`dm:a${String.fromCharCode(code)}b`), null, `C0 character ${code}`)
    }
    for (const key of ["dm:Я🙂é", `dm:${"🙂".repeat(15)}`, "dm:ab\u007f", "room:1", "room:9999999999"]) {
        assert.deepEqual(parse(key)?.mutedChats, [key])
    }
    for (const key of ["dm:🙂é", `dm:${"🙂".repeat(16)}`, "dm:a\u00a0b", "room:0", "room:10000000000"]) {
        assert.equal(parse(key), null)
    }
})

test("provider payload contains routing metadata and TTL without notification plaintext", () => {
    const now = Date.now(),
        item = delivery({ expiresAt: now + 1900 })
    const payload = pushMessage(item, now)
    assert.equal(payload.message.android.ttl, "2s")
    assert.equal("notification" in payload.message, false)
    assert.deepEqual(Object.keys(payload.message.data).sort(), [
        "chat",
        "eventId",
        "expiresAt",
        "kind",
        "messageId",
        "title"
    ])
    assert.deepEqual(JSON.parse(payload.message.data.chat), {
        ...item.target,
        eventId: item.eventKey,
        expiresAt: item.expiresAt
    })
    assert.equal(payload.message.data.eventId, "m:11")
    assert.equal(payload.message.data.messageId, "11")
})

test("RuStore sender uses scoped HTTPS transport and classifies provider responses", async () => {
    let captured: { url: string; options: Parameters<PushRequest>[1] } | null = null
    const cases: Array<[number, string | undefined, PushResult]> = [
        [200, undefined, "sent"],
        [404, "UNREGISTERED", "invalid_token"],
        [404, "NOT_FOUND", "invalid_token"],
        [401, undefined, "retry"],
        [403, undefined, "retry"],
        [429, undefined, "retry"],
        [503, undefined, "retry"],
        [400, "INVALID_ARGUMENT", "rejected"]
    ]
    for (const [status, code, expected] of cases) {
        const request: PushRequest = async (url, options) => {
            captured = { url, options }
            return { ok: status === 200, status, json: async () => ({ error: { status: code } }) }
        }
        const sender = new RuStorePushSender(
            { projectId: "test/project", serviceToken: "test-service-secret" },
            request
        )
        assert.equal(await sender.send(delivery()), expected)
    }
    assert.ok(captured)
    const request = captured as { url: string; options: Parameters<PushRequest>[1] }
    assert.equal(request.url, "https://vkpns-dg.rustore.ru/v1/projects/test%2Fproject/messages:send")
    assert.equal(request.options.headers.Authorization, "Bearer test-service-secret")
    assert.equal(request.options.body.includes("test-service-secret"), false)
    assert.ok(request.options.signal instanceof AbortSignal)
})

test("expired events never contact provider; network failures remain retryable", async () => {
    let calls = 0
    const sender = new RuStorePushSender({ projectId: "test", serviceToken: "test-secret" }, async () => {
        calls++
        throw new Error("synthetic network timeout")
    })
    assert.equal(await sender.send(delivery({ expiresAt: Date.now() - 1 })), "rejected")
    assert.equal(calls, 0)
    assert.equal(await sender.send(delivery()), "retry")
    assert.equal(calls, 1)
})

test("dispatcher rechecks consent and expiry before sending", async () => {
    for (const [allowed, expired] of [
        [false, false],
        [true, true]
    ]) {
        const item = delivery({ expiresAt: expired ? 99 : 101 })
        const state = queueFixture([item], allowed)
        let sent = false
        await new PushDispatcher(
            state.queue,
            {
                send: async () => {
                    sent = true
                    return "sent"
                }
            },
            () => 100
        ).flush()
        assert.equal(sent, false)
        assert.deepEqual(state.completed, [item.id])
    }
})

test("invalid token revokes only its claimed binding, retries are bounded", async () => {
    const invalid = delivery(),
        firstRetry = delivery({ id: "102", attempts: 1 }),
        exhausted = delivery({ id: "103", attempts: 8 })
    const state = queueFixture([invalid, firstRetry, exhausted])
    await new PushDispatcher(state.queue, {
        send: async (item) => (item.id === invalid.id ? "invalid_token" : "retry")
    }).flush()
    assert.deepEqual(state.invalidated, [`${invalid.deviceId}:${invalid.token}`])
    assert.deepEqual(state.completed, [invalid.id, exhausted.id])
    assert.deepEqual(state.retries, [[firstRetry.id, 10]])
})

test("overlapping worker ticks cannot double-send a claimed event", async () => {
    const state = queueFixture([delivery()])
    let release: (() => void) | undefined,
        calls = 0
    const wait = new Promise<void>((resolve) => {
        release = resolve
    })
    const dispatcher = new PushDispatcher(state.queue, {
        send: async () => {
            calls++
            await wait
            return "sent"
        }
    })
    const first = dispatcher.flush()
    await Promise.resolve()
    await Promise.resolve()
    await dispatcher.flush()
    assert.equal(calls, 1)
    release!()
    await first
    assert.deepEqual(state.completed, ["101"])
})
