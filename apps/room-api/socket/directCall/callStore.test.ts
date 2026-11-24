import assert from "node:assert/strict"
import { test } from "node:test"
import Redis from "ioredis"
import { tryLease } from "../../lease"
import { createPartyDepartureStore } from "../party/departureStore"
import { createCallStore, CALL_HISTORY_STREAM, CALL_RING_MS, ROOM_PREFIX } from "./callStore"
import { deliverCallHistory } from "./callHistory"
import { expectCallInstance } from "./instance"
import { clearCallRingTimeout, scheduleCallRingTimeout } from "./ringTimeout"

const url = process.env.PLAYTIME_TEST_REDIS_URL
const integration = url ? test : test.skip

function deferred() {
    let resolve!: () => void
    let reject!: (error: unknown) => void
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, resolve, reject }
}

function setup() {
    const parsed = new URL(url!)
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "16389") throw new Error("Use the isolated test Redis on localhost:16389")
    const redis = new Redis(url!, { maxRetriesPerRequest: 1 })
    return { redis, store: createCallStore(redis) }
}

integration("reciprocal simultaneous calls join one session instead of cancelling each other", async () => {
    const { redis, store } = setup()
    try {
        await redis.flushdb()
        const results = await Promise.all([store.reserve(1, 2), store.reserve(2, 1)])
        assert.equal(results.filter(r => r.kind === "created").length, 1)
        assert.equal(results.filter(r => r.kind === "joined").length, 1)
        assert.equal(results[0].roomId, results[1].roomId)
        const a = await store.current(1), b = await store.current(2)
        assert.equal(a.roomId, b.roomId)
        assert.equal(a.room?.status, "in_call")
        assert.equal(a.room?.revision, 2)
    } finally { await redis.quit() }
})

integration("concurrent callers cannot reserve the same recipient and retries preserve an existing call", async () => {
    const { redis, store } = setup()
    try {
        await redis.flushdb()
        const results = await Promise.all(Array.from({ length: 10 }, (_, i) => store.reserve(i + 10, 2)))
        const winner = results.find(r => r.kind === "created")!
        assert.equal(results.filter(r => r.kind === "created").length, 1)
        assert.equal(results.filter(r => r.kind === "callee_busy").length, 9)
        const retry = await store.reserve(winner.room!.beginer_id, 2)
        assert.equal(retry.kind, "existing")
        assert.equal(retry.roomId, winner.roomId)
        assert.equal((await store.reserve(winner.room!.beginer_id, 99)).kind, "caller_busy")
        assert.equal((await store.current(2)).roomId, winner.roomId)
    } finally { await redis.quit() }
})

integration("six independent calls are allowed and an outsider cannot change a call or its timeout", async () => {
    const { redis, store } = setup()
    try {
        await redis.flushdb()
        const results = await Promise.all(Array.from({ length: 6 }, (_, i) => store.reserve(10 + i * 2, 11 + i * 2)))
        assert(results.every(r => r.kind === "created"))
        const first = results[0]
        for (const action of ["accept", "reject", "end", "expire"] as const) assert.equal((await store.transition(first.roomId!, 999, action)).kind, "forbidden")
        assert.deepEqual((await store.current(10)).room, first.room)
        assert.equal((await store.transition(first.roomId!, 10, "accept")).kind, "forbidden")
    } finally { await redis.quit() }
})

integration("old events cannot end a subsequent call and an accepted call cannot be rejected later", async () => {
    const { redis, store } = setup()
    try {
        await redis.flushdb()
        const old = await store.reserve(1, 2)
        const ended = await Promise.all([store.transition(old.roomId!, 1, "end"), store.transition(old.roomId!, 2, "end")])
        assert.equal(ended.filter(r => r.kind === "ended").length, 1)
        const current = await store.reserve(1, 2)
        assert.notEqual(current.roomId, old.roomId)
        assert.equal((await store.transition(old.roomId!, 2, "accept")).kind, "missing")
        assert.equal((await store.transition(old.roomId!, 1, "end")).kind, "missing")
        assert.equal((await store.transition(current.roomId!, 2, "accept")).kind, "accepted")
        assert.equal((await store.transition(current.roomId!, 2, "reject")).kind, "already_accepted")
        assert.equal((await store.current(1)).room?.status, "in_call")
    } finally { await redis.quit() }
})

integration("ring expiry is stored in Redis and remains enforceable after a process restart", async t => {
    const { redis, store } = setup()
    try {
        await redis.flushdb()
        const call = await store.reserve(1, 2)
        const now = Date.now()
        t.mock.method(Date, "now", () => now + CALL_RING_MS + 1)
        const restarted = createCallStore(redis)
        assert.equal((await restarted.transition(call.roomId!, 1, "expire")).kind, "ended")
        assert.equal((await restarted.current(1)).kind, "missing")
        assert.equal((await restarted.current(2)).kind, "missing")
        assert.equal((await restarted.reserve(1, 2)).kind, "created")
    } finally { await redis.quit() }
})

integration("a rolling restart preserves active ownership and repairs legacy indexes without replacing rooms", async () => {
    const { redis, store } = setup()
    const { redis: standby, store: replacement } = setup()
    try {
        await redis.flushdb()
        const caller = { endpointKey: "caller", socketId: "gateway-1", modern: true }
        const callee = { endpointKey: "callee", socketId: "gateway-2", modern: true }
        const reserved = await store.reserve(1, 2, true, caller, true)
        assert.ok(reserved.roomId)
        const confirmed = await store.transition(reserved.roomId, 2, "accept", callee)
        assert.equal(confirmed.kind, "accepted")
        await redis.pexpire(ROOM_PREFIX + reserved.roomId, 60_000)

        const oldRoom = { beginer_id: 3, receiver_id: 4, status: "in_call", confirmed_at: Date.now() }
        await redis.set(ROOM_PREFIX + "3:4", JSON.stringify(oldRoom), "PX", 60_000)
        await Promise.all([store.repairLegacyRooms(), replacement.repairLegacyRooms()])

        assert.deepEqual(await replacement.get(reserved.roomId), confirmed.room)
        assert.ok((await redis.pttl(ROOM_PREFIX + reserved.roomId)) <= 60_000)
        assert.deepEqual((await replacement.current(3)).room, { ...oldRoom, revision: 2 })
        assert.equal(await standby.get("call:user:4"), "3:4")
    } finally {
        await Promise.all([redis.quit(), standby.quit()])
    }
})

integration("the peer replica enforces a pending ring once after rollout", async (t) => {
    const { redis, store } = setup()
    const { redis: standby, store: replacement } = setup()
    try {
        await redis.flushdb()
        const ringing = await store.reserve(1, 2)
        assert.ok(ringing.roomId && ringing.room?.expires_at)
        const now = ringing.room.expires_at + 1
        await redis.del("call:ring-deadlines")
        await replacement.repairLegacyRooms()
        assert.deepEqual(await replacement.dueRingDeadlines(), [])
        t.mock.method(Date, "now", () => now)
        assert.deepEqual(await replacement.dueRingDeadlines(), [ringing.roomId])
        const results = await Promise.all([
            replacement.expirePendingRing(ringing.roomId),
            store.expirePendingRing(ringing.roomId)
        ])
        assert.deepEqual(results.map(({ kind }) => kind).sort(), ["ended", "missing"])
        assert.deepEqual(await replacement.dueRingDeadlines(), [])
    } finally {
        await Promise.all([redis.quit(), standby.quit()])
    }
})

integration("a replacement Room ends the disconnected owner only while its socket is offline", async () => {
    const { redis, store } = setup()
    const { redis: standby, store: replacement } = setup()
    try {
        await redis.flushdb()
        const caller = { endpointKey: "caller", socketId: "gateway-1", modern: true }
        const callee = { endpointKey: "callee", socketId: "gateway-2", modern: true }
        await store.registerEndpoint(caller)
        const ringing = await store.reserve(1, 2, true, caller, true)
        assert.ok(ringing.roomId)
        const call = await store.transition(ringing.roomId, 2, "accept", callee)
        assert.ok(call.room)
        const disconnected = { ...caller, ...expectCallInstance(call.room), ownershipRevision: 1, requireOfflineSocket: true }

        assert.equal((await replacement.transition(ringing.roomId, 1, "end", disconnected)).kind, "forbidden")
        await store.disconnectEndpoint(caller.socketId)
        assert.equal((await replacement.transition(ringing.roomId, 1, "end", disconnected)).kind, "ended")
    } finally {
        await Promise.all([redis.quit(), standby.quit()])
    }
})

test("delayed scheduling and cancellation for one call leave the replacement's timer intact", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const roomId = "1:2"
    const original = { expires_at: 100 }
    const replacement = { expires_at: 200 }
    const expired: string[] = []
    scheduleCallRingTimeout(roomId, original, () => expired.push("original"), 10)
    scheduleCallRingTimeout(roomId, replacement, () => expired.push("replacement"), 20)
    scheduleCallRingTimeout(roomId, original, () => expired.push("delayed"), 5)
    clearCallRingTimeout(roomId, original)
    t.mock.timers.tick(20)
    assert.deepEqual(expired, ["replacement"])
})

integration("a stale expiry cannot delete a replacement Redis room with the same public ID", async (t) => {
    const { redis, store } = setup()
    try {
        await redis.flushdb()
        let now = Date.now()
        t.mock.method(Date, "now", () => now)
        const original = await store.reserve(1, 2, false)
        assert.ok(original.roomId && original.room)
        const roomId = original.roomId
        await store.transition(roomId, 1, "end")
        const replacement = await store.reserve(1, 2, false)
        assert.ok(replacement.room?.expires_at)
        assert.equal(replacement.roomId, roomId)
        assert.equal(replacement.room.expires_at, original.room.expires_at)
        now = replacement.room.expires_at + 1
        const firstGuard = { internal: true, ...expectCallInstance(original.room) } as const
        assert.equal((await store.transition(roomId, 1, "expire", firstGuard)).kind, "forbidden")
        assert.equal((await store.transition(roomId, 1, "end", firstGuard)).kind, "forbidden")
        assert.equal((await store.transition(roomId, 1, "expire", {
            internal: true,
            ...expectCallInstance(replacement.room)
        })).kind, "ended")

        const legacy = { status: "request_receiver", beginer_id: 1, receiver_id: 2, expires_at: now + 10 } as const
        const legacyReplacement = { ...legacy, expires_at: now + 20 }
        await store.importLegacy(roomId, legacy)
        await store.importLegacy(roomId, legacyReplacement)
        now = legacyReplacement.expires_at + 1
        assert.equal((await store.transition(roomId, 1, "expire", {
            internal: true,
            ...expectCallInstance(legacy)
        })).kind, "forbidden")
        assert.equal((await store.transition(roomId, 1, "expire", {
            internal: true,
            ...expectCallInstance(legacyReplacement)
        })).kind, "ended")
    } finally {
        await redis.quit()
    }
})

integration("confirmed call history survives a worker restart and a failed delivery", async (t) => {
    const { redis, store } = setup()
    const { redis: restarted } = setup()
    try {
        await redis.flushdb()
        store.enableDurableHistory()

        const ringing = await store.reserve(1, 2)
        await store.transition(ringing.roomId!, 2, "reject")
        const reserved = await store.reserve(1, 2)
        const confirmed = await store.transition(reserved.roomId!, 2, "accept")
        const confirmedAt = confirmed.room!.confirmed_at!
        const endedAt = confirmedAt + 61_000
        t.mock.method(Date, "now", () => endedAt)

        await redis.set(CALL_HISTORY_STREAM, "wrong data type")
        await assert.rejects(store.transition(reserved.roomId!, 1, "end"), /WRONGTYPE/)
        assert.equal((await store.get(reserved.roomId!))?.status, "in_call")
        await redis.del(CALL_HISTORY_STREAM)

        const ended = await Promise.all([
            store.transition(reserved.roomId!, 1, "end"),
            store.transition(reserved.roomId!, 2, "end")
        ])
        assert.equal(ended.filter((result) => result.kind === "ended").length, 1)
        assert.equal(await redis.xlen(CALL_HISTORY_STREAM), 1)

        await assert.rejects(deliverCallHistory(redis, async () => { throw new Error("Chat unavailable") }), /Chat unavailable/)
        const received: unknown[] = []
        await deliverCallHistory(restarted, async (entry) => { received.push(entry) })
        assert.deepEqual(received, [{
            roomId: reserved.roomId,
            beginerId: 1,
            receiverId: 2,
            confirmedAt,
            endedAt,
            instanceId: reserved.room!.instance_id
        }])
        assert.equal(await restarted.xlen(CALL_HISTORY_STREAM), 0)
    } finally {
        await Promise.all([redis.quit(), restarted.quit()])
    }
})

integration("the other Room worker leaves a claimed history entry to its first delivery", async () => {
    const { redis } = setup()
    const { redis: standby } = setup()
    const deliveryEntered = deferred()
    const releaseDelivery = deferred()
    let first: Promise<void> | undefined
    try {
        await redis.flushdb()
        await redis.xadd(CALL_HISTORY_STREAM, "*", "call", "{}")
        first = deliverCallHistory(redis, async () => {
            deliveryEntered.resolve()
            await releaseDelivery.promise
        }).catch((error: unknown) => {
            deliveryEntered.reject(error)
            throw error
        })
        await deliveryEntered.promise
        await deliverCallHistory(standby, async () => assert.fail("Concurrent call history delivery"))
        assert.equal(await redis.xlen(CALL_HISTORY_STREAM), 1)
        releaseDelivery.resolve()
        await first
        assert.equal(await redis.xlen(CALL_HISTORY_STREAM), 0)
    } finally {
        releaseDelivery.resolve()
        await first?.catch(() => {})
        await Promise.all([redis.quit(), standby.quit()])
    }
})

integration("a Room lease cannot invalidate a newer holder after a pod loses ownership", async () => {
    const { redis } = setup()
    const { redis: standby } = setup()
    const key = "room:voice:admission:1"
    try {
        await redis.flushdb()
        const previous = await tryLease(redis, key, 1000)
        assert.ok(previous)
        assert.equal(await tryLease(standby, key, 1000), undefined)
        await redis.pexpire(key, 0)
        const active = await tryLease(standby, key, 1000)
        assert.ok(active)
        await assert.rejects(previous.renew(), /lease expired/)
        await previous.release()
        assert.equal(await tryLease(redis, key, 1000), undefined)
        await active.release()
    } finally {
        await Promise.all([redis.quit(), standby.quit()])
    }
})

integration("party rejoin cancels departure and two Room workers cannot publish the same leave", async () => {
    const { redis } = setup()
    const { redis: standby } = setup()
    const store = createPartyDepartureStore(redis)
    const replacement = createPartyDepartureStore(standby)
    const participant = { roomId: 1, userId: 2 }
    try {
        await redis.flushdb()
        await store.remember(participant, "caller", 2000)
        assert.deepEqual(await replacement.due(1999), [])
        assert.deepEqual(await replacement.due(2000), [participant])
        await replacement.remove(participant)
        assert.deepEqual(await store.due(2000), [])

        await replacement.remember(participant, "caller", 3000)
        await store.remember(participant, "earlier", 2000)
        assert.equal(await store.remove(participant, 2000), undefined)
        const departed = await Promise.all([store.remove(participant, 3000), replacement.remove(participant, 3000)])
        assert.deepEqual(departed.filter(Boolean), ["caller"])
        assert.deepEqual(await replacement.due(3000), [])
    } finally {
        await Promise.all([redis.quit(), standby.quit()])
    }
})
