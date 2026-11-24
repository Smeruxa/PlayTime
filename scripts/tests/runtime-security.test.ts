import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHmac } from "node:crypto"
import { EventEmitter, once } from "node:events"
import { readFileSync } from "node:fs"
import { createServer, request, type Server } from "node:http"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { deserialize, serialize } from "node:v8"
import type Redis from "ioredis"
import { test } from "node:test"
import WebSocket from "ws"
import { getIceServers } from "../../apps/room-api/media/iceServers"
import { allowScreenFrame } from "../../apps/room-api/media/screenBroadcastThrottle"
import { isValidScreenFrame, MAX_SCREEN_FRAME_LENGTH } from "../../apps/room-api/media/screenFrame"
import { createCallStore } from "../../apps/room-api/socket/directCall/callStore"
import { isOptionalCallRevision } from "../../apps/room-api/socket/directCall/revision"
import { proxyService } from "../../apps/shared/runtime/internalHttp"
import { maxRelayPayload, ServiceRelay } from "../../apps/shared/runtime/relay"

const backendRequire = createRequire(resolve("apps/package.json"))
const express = backendRequire("express")

async function start(server: Server): Promise<URL> {
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const address = server.address()
    assert.ok(address && typeof address === "object")
    return new URL(`http://127.0.0.1:${address.port}`)
}

function forward(origin: URL, method: string, headers: Record<string, string> = {}, body?: string) {
    return new Promise<{ status?: number; body: string }>((resolve, reject) => {
        const remote = request(new URL("/playtime/auth/fixture", origin), { method, headers }, (reply) => {
            reply.setEncoding("utf8")
            let text = ""
            reply.on("data", (part: string) => {
                text += part
            })
            reply.on("end", () => resolve({ status: reply.statusCode, body: text }))
            reply.on("error", reject)
        })
        remote.on("error", reject)
        remote.end(body)
    })
}

test("proxy rejects bodies on bodyless methods and frames accepted requests exactly once", async (t) => {
    const originalSecret = process.env.PLAYTIME_INTERNAL_SECRET
    process.env.PLAYTIME_INTERNAL_SECRET = "fixture-only-not-a-deployment-secret"
    t.after(() => {
        if (originalSecret === undefined) delete process.env.PLAYTIME_INTERNAL_SECRET
        else process.env.PLAYTIME_INTERNAL_SECRET = originalSecret
    })
    const requests: { body: string; length?: string; transfer?: string }[] = []
    const upstream = createServer((req, res) => {
        req.setEncoding("utf8")
        let body = ""
        req.on("data", (part: string) => {
            body += part
        })
        req.on("end", () => {
            requests.push({ body, length: req.headers["content-length"], transfer: req.headers["transfer-encoding"] })
            res.end(body || "ready")
        })
    })
    const upstreamUrl = await start(upstream)
    const app = express()
    app.use(proxyService({ auth: upstreamUrl, chat: upstreamUrl }))
    const server = createServer(app)
    const local = await start(server)
    t.after(async () => {
        await Promise.all([server, upstream].map((item) => new Promise<void>((resolve) => item.close(() => resolve()))))
    })

    const content = "test body"
    for (const method of ["GET", "DELETE", "OPTIONS"]) {
        assert.equal((await forward(local, method, { "Transfer-Encoding": "chunked" }, content)).status, 400)
        assert.equal(
            (await forward(local, method, { Connection: "content-length", "Content-Length": "9" }, content)).status,
            400
        )
    }
    assert.deepEqual(requests, [])
    assert.equal(
        (await forward(local, "POST", { Connection: "content-length", "Content-Length": "9" }, content)).body,
        content
    )
    assert.equal((await forward(local, "POST", { "Transfer-Encoding": "chunked" }, content)).body, content)
    assert.deepEqual(await forward(local, "GET"), { status: 200, body: "ready" })
    assert.deepEqual(requests, [
        { body: content, length: "9", transfer: undefined },
        { body: content, length: undefined, transfer: "chunked" },
        { body: "", length: undefined, transfer: undefined }
    ])
})

test("relay drops oversized queued replies and keeps the connection for the next command", async () => {
    class RelayPeer extends EventEmitter {
        readyState = WebSocket.OPEN
        bufferedAmount = maxRelayPayload * 2 - 2000
        sent: unknown[] = []
        send(payload: Buffer) {
            this.sent.push(deserialize(payload))
        }
        close() {
            assert.fail("Backpressure must not close the relay")
        }
    }
    const peer = new RelayPeer()
    const relay = new ServiceRelay(peer as unknown as WebSocket, { "io:fetch": () => [] })
    const dispatch = () =>
        peer.emit("message", serialize({ kind: "request", id: 1, method: "io:fetch", args: ["room"] }), true)
    try {
        dispatch()
        await new Promise<void>((resolve) => setImmediate(resolve))
        assert.deepEqual(peer.sent, [{ kind: "response", id: 1, ok: false }])
        assert.ok(relay.connected)
        peer.bufferedAmount = 0
        dispatch()
        await new Promise<void>((resolve) => setImmediate(resolve))
        assert.deepEqual(peer.sent[peer.sent.length - 1], { kind: "response", id: 1, ok: true, value: [] })
    } finally {
        peer.emit("close")
    }
})

test("screen frame budgets apply across account sessions", async () => {
    const seen = new Set<string>()
    const set = async (key: string, _value: string, expiry: string, interval: number, mode: string) => {
        assert.equal(expiry, "PX")
        assert.equal(interval, 100)
        assert.equal(mode, "NX")
        if (seen.has(key)) return null
        seen.add(key)
        return "OK"
    }
    const redis = { set } as unknown as Pick<Redis, "set">
    assert.equal(await allowScreenFrame(redis, 12, 10), true)
    assert.equal(await allowScreenFrame(redis, 12, 10), false)
    assert.equal(await allowScreenFrame(redis, 13, 10), true)
    assert.ok(isValidScreenFrame("data:image/jpeg;base64,YWJj"))
    assert.ok(!isValidScreenFrame("data:image/jpeg;base64,YWJj\n"))
    assert.ok(!isValidScreenFrame("data:image/jpeg;base64," + "A".repeat(MAX_SCREEN_FRAME_LENGTH)))
})

test("call ownership accepts legacy omission and supplies only scalar Redis arguments", async () => {
    assert.ok(isOptionalCallRevision(undefined))
    assert.ok(isOptionalCallRevision(0))
    assert.ok(!isOptionalCallRevision(null))
    assert.ok(!isOptionalCallRevision(1.5))
    let calls = 0
    const store = createCallStore({
        eval: async (...args: unknown[]) => {
            calls++
            assert.ok(args.slice(2).every((value) => typeof value === "string"))
            return '{"kind":"missing"}'
        }
    } as unknown as Parameters<typeof createCallStore>[0])
    await store.ownership("fixture", 22, "heartbeat", undefined)
    await assert.rejects(store.ownership("fixture", 22, "heartbeat", undefined, NaN), /Invalid call store argument/)
    assert.equal(calls, 1)
})

test("configured TURN credentials last an hour and remain scoped to the caller", () => {
    const host = process.env.WEBRTC_TURN_HOST
    const secret = process.env.WEBRTC_TURN_SECRET
    try {
        process.env.WEBRTC_TURN_HOST = "turn.fixture.test"
        process.env.WEBRTC_TURN_SECRET = "fixture-only-turn-secret"
        const now = Math.floor(Date.now() / 1000)
        const servers = getIceServers(42)
        const turn = servers[servers.length - 1]
        assert.match(turn.username!, /^\d+:42$/)
        assert.ok(Number(turn.username!.split(":")[0]) - now >= 3600)
        assert.ok(Number(turn.username!.split(":")[0]) - now <= 3601)
        assert.equal(
            turn.credential,
            createHmac("sha1", process.env.WEBRTC_TURN_SECRET).update(turn.username!).digest("base64")
        )
    } finally {
        if (host === undefined) delete process.env.WEBRTC_TURN_HOST
        else process.env.WEBRTC_TURN_HOST = host
        if (secret === undefined) delete process.env.WEBRTC_TURN_SECRET
        else process.env.WEBRTC_TURN_SECRET = secret
    }
})

function node(code: string, values: Record<string, string> = {}) {
    return spawnSync(process.execPath, ["--import", "tsx", "-e", code], {
        encoding: "utf8",
        env: {
            ...process.env,
            JWT_SECRET_ENV: "",
            PLAYTIME_ALLOW_DEV_JWT_SECRET: "",
            DOTENV_CONFIG_PATH: "/dev/null",
            ...values
        }
    })
}

test("JWT signing has no default key and development needs explicit opt-in", () => {
    const check =
        'const {validateSigningSecret, redis} = require("./apps/shared/config.ts"); redis.disconnect(); validateSigningSecret()'
    for (const NODE_ENV of ["development", "test", "production"]) {
        assert.match(node(check, { NODE_ENV }).stderr, /JWT_SECRET_ENV/)
    }
    const dev = { PLAYTIME_ALLOW_DEV_JWT_SECRET: "1" }
    assert.equal(node(check, { ...dev, NODE_ENV: "development" }).status, 0)
    assert.notEqual(node(check, { ...dev, NODE_ENV: "production" }).status, 0)
})

test("production warns when proxy trust is implicit", () => {
    const check = 'require("./apps/shared/http/clientIp.ts").warnMissingTrustedProxyIps()'
    assert.match(node(check, { NODE_ENV: "production", TRUSTED_PROXY_IPS: "" }).stderr, /TRUSTED_PROXY_IPS is unset/)
    assert.equal(node(check, { NODE_ENV: "production", TRUSTED_PROXY_IPS: "127.0.0.1" }).stderr, "")
})

test("service reports an unhandled rejection and exits unsuccessfully", () => {
    const check =
        'require("./apps/shared/runtime/service.ts").runService(async () => { void Promise.reject(new TypeError()) })'
    const result = node(check)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /PlayTime unhandled rejection TypeError/)
})

test("Android preview may use the debug key only with a different application ID", () => {
    const gradle = readFileSync("mobile/android/app/build.gradle", "utf8")
    const preview = gradle.match(/\bpreview\s*\{([^}]+)\}/)?.[1]
    assert.match(preview ?? "", /applicationIdSuffix "\.preview"/)
    assert.match(preview ?? "", /signingConfig signingConfigs\.debug/)
})
