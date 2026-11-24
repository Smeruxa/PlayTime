const test = require("node:test")
const assert = require("node:assert/strict")
const Redis = require("../../apps/node_modules/ioredis")
const { createCallStore } = require("../../apps/room-api/socket/directCall/callStore.ts")

const url = process.env.CALL_OWNERSHIP_TEST_REDIS_URL
if (url && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname))
    throw new Error("Ownership tests require isolated localhost Redis")

test("atomic participant media ownership and socket leases", { skip: !url, timeout: 15_000 }, async () => {
    const redis = new Redis(url, { maxRetriesPerRequest: 1, retryStrategy: () => null })
    redis.on("error", () => {})
    const store = createCallStore(redis)
    const uid = 910001,
        peer = 910002
    const phone = { endpointKey: "test-phone", socketId: "phone-1", modern: true }
    const pc = { endpointKey: "test-pc", socketId: "pc-1", modern: true }
    const other = { endpointKey: "test-other", socketId: "other-1", modern: true }
    try {
        await Promise.all([phone, pc, other].map((actor) => store.registerEndpoint(actor)))
        const reserved = await store.reserve(uid, peer, true, phone, true)
        assert.equal(reserved.kind, "created")
        const id = reserved.roomId
        assert.equal((await store.transition(id, peer, "accept", other)).kind, "accepted")
        assert.equal((await store.ownership(id, uid, "attach", pc)).room.owners[uid].socketId, phone.socketId)
        assert.equal((await store.ownership(id, uid, "signal", pc, 1, 1)).kind, "forbidden")
        const claims = await Promise.all([
            store.ownership(id, uid, "claim", pc, 1),
            store.ownership(id, peer, "claim", other, 1)
        ])
        assert.equal(claims[0].kind, "claimed")
        assert.equal(claims[1].kind, "existing")
        assert.equal(claims[0].room.owners[uid].ownershipRevision, 2)
        assert.equal((await store.transition(id, uid, "end", phone)).kind, "forbidden")
        assert.equal((await store.ownership(id, uid, "signal", phone, 1, 1)).kind, "forbidden")
        assert.equal((await store.ownership(id, peer, "signal", other, 1, 1)).kind, "forbidden")
        assert.equal((await store.ownership(id, peer, "signal", other, 1, 2)).kind, "existing")
        assert.equal((await store.ownership(id, uid, "claim", phone, 1)).kind, "stale")
        const reconnect = { ...pc, socketId: "pc-2" }
        await store.registerEndpoint(reconnect)
        assert.equal(await store.renewEndpoint(pc), 0)
        assert.equal(await store.renewEndpoint(reconnect), 1)
        assert.equal(await redis.get("call:endpoint:" + pc.endpointKey), reconnect.socketId)
        await redis.del("call:endpoint:" + pc.endpointKey, "call:socket:" + reconnect.socketId)
        assert.equal(await store.renewEndpoint(reconnect), 1)
        assert.equal(await redis.get("call:endpoint:" + pc.endpointKey), reconnect.socketId)
        assert.equal(await redis.get("call:socket:" + reconnect.socketId), "1")
        assert.equal(await store.renewEndpoint(pc), 0)
        assert.equal((await store.ownership(id, uid, "authorize", pc)).kind, "forbidden")
        await store.ownership(id, uid, "attach", reconnect)
        assert.equal((await store.transition(id, uid, "end", pc)).kind, "forbidden")
        assert.equal((await store.ownership(id, uid, "signal", reconnect, 2, 1)).kind, "existing")
        assert.equal((await store.ownership(id, uid, "claim", phone, 2)).kind, "claimed")
        assert.equal((await store.transition(id, uid, "end", { ...phone, ownershipRevision: 1 })).kind, "forbidden")
        assert.equal((await store.ownership(id, uid, "authorize", phone, 1)).kind, "forbidden")
        assert.equal((await store.ownership(id, uid, "heartbeat", phone, 1)).kind, "forbidden")
        assert.equal((await store.ownership(id, uid, "authorize", phone, 3)).kind, "existing")
        assert.equal((await store.ownership(id, uid, "heartbeat", phone, 3)).kind, "existing")
        assert.equal((await store.transition(id, uid, "end", { ...phone, ownershipRevision: 3 })).kind, "ended")
        const lateCallee = await store.reserve(uid, peer, true, phone, false)
        const lateAccepted = await store.transition(lateCallee.roomId, peer, "accept", other)
        assert.equal(lateAccepted.room.takeoverEnabled, true)
        assert.equal((await store.ownership(lateCallee.roomId, uid, "claim", reconnect, 1)).kind, "claimed")
        await store.remove(lateCallee.roomId)
        const reverse = await store.reserve(uid, peer, true, phone, false)
        const reverseJoined = await store.reserve(peer, uid, true, other, false)
        assert.equal(reverseJoined.kind, "joined")
        assert.equal(reverseJoined.room.takeoverEnabled, true)
        await store.remove(reverse.roomId)
        const legacy = { endpointKey: "test-legacy", socketId: "legacy-1", sessionKey: "session-legacy" }
        await store.registerEndpoint(legacy)
        const mixed = await store.reserve(uid, peer, true, phone, false)
        assert.equal((await store.transition(mixed.roomId, peer, "accept", legacy)).kind, "accepted")
        assert.equal((await store.ownership(mixed.roomId, peer, "signal", legacy)).kind, "existing")
        assert.equal((await store.ownership(mixed.roomId, uid, "claim", pc, 1)).kind, "forbidden")
        const legacyReconnect = {
            ...legacy,
            endpointKey: "test-legacy-new",
            socketId: "legacy-2",
            previousSocket: legacy.socketId
        }
        await store.registerEndpoint(legacyReconnect)
        assert.equal((await store.ownership(mixed.roomId, peer, "legacyAttach", legacyReconnect, 1)).kind, "forbidden")
        await store.disconnectEndpoint(legacy.socketId)
        assert.equal(
            (
                await store.ownership(
                    mixed.roomId,
                    peer,
                    "legacyAttach",
                    { ...legacyReconnect, sessionKey: "foreign" },
                    1
                )
            ).kind,
            "forbidden"
        )
        assert.equal((await store.ownership(mixed.roomId, peer, "legacyAttach", legacyReconnect, 1)).kind, "existing")
        assert.equal((await store.transition(mixed.roomId, peer, "end", legacy)).kind, "forbidden")
        assert.equal((await store.ownership(mixed.roomId, peer, "signal", legacy)).kind, "forbidden")
        assert.equal((await store.ownership(mixed.roomId, peer, "signal", legacyReconnect)).kind, "existing")
        await store.remove(mixed.roomId)
        await redis.del("call:endpoint:" + legacyReconnect.endpointKey)
        await store.disconnectEndpoint(legacyReconnect.socketId)
        const inbound = await store.reserve(peer, uid, true, legacy, false)
        assert.equal(inbound.room.owners, undefined)
        assert.equal((await store.ownership(inbound.roomId, peer, "signal", legacy)).kind, "forbidden")
        assert.equal((await store.transition(inbound.roomId, peer, "end", phone)).kind, "forbidden")
        assert.equal((await store.ownership(inbound.roomId, uid, "signal", phone, 0, 0)).kind, "forbidden")
        const accepted = await store.transition(inbound.roomId, uid, "accept", phone)
        assert.equal(accepted.room.owners[uid].modern, true)
        assert.equal(accepted.room.owners[peer].socketId, legacy.socketId)
        assert.equal((await store.ownership(inbound.roomId, uid, "authorize", pc, 1)).kind, "forbidden")
        await store.remove(inbound.roomId)
        const originalInstance = await store.reserve(uid, peer, false, phone, false)
        await store.transition(originalInstance.roomId, peer, "accept", legacy)
        await store.remove(originalInstance.roomId)
        const nextInstance = await store.reserve(uid, peer, false, phone, false)
        await store.transition(nextInstance.roomId, peer, "accept", legacy)
        assert.equal(originalInstance.roomId, nextInstance.roomId)
        assert.notEqual(originalInstance.room.instance_id, nextInstance.room.instance_id)
        assert.equal(
            (
                await store.transition(nextInstance.roomId, uid, "end", {
                    ...phone,
                    ownershipRevision: 1,
                    expectedInstanceId: originalInstance.room.instance_id
                })
            ).kind,
            "forbidden"
        )
        await store.remove(nextInstance.roomId)
        await redis.del("call:endpoint:" + legacy.endpointKey)
    } finally {
        try {
            const current = await store.current(uid)
            if (current.roomId) await store.remove(current.roomId)
            await redis.del(...[phone, pc, other].map((actor) => "call:endpoint:" + actor.endpointKey))
            await Promise.all([phone, pc, other].map((actor) => store.disconnectEndpoint(actor.socketId)))
            await store.disconnectEndpoint("pc-2")
            await store.disconnectEndpoint("legacy-1")
        } finally {
            redis.disconnect()
        }
    }
})

test(
    "a foreign same-user socket cannot cancel a mixed-room owner's disconnect deadline",
    { skip: !url, timeout: 15_000 },
    async () => {
        const fs = require("node:fs")
        const vm = require("node:vm")
        const ts = require("typescript")
        const redis = new Redis(url, { maxRetriesPerRequest: 1, retryStrategy: () => null })
        redis.on("error", () => {})
        const store = createCallStore(redis)
        const caller = 910003,
            receiver = 910004
        const modern = { endpointKey: "deadline-modern", socketId: "deadline-a", modern: true }
        const legacy = { endpointKey: "deadline-legacy", socketId: "deadline-b1", sessionKey: "original-session" }
        const foreign = { endpointKey: "deadline-foreign", socketId: "deadline-b2", sessionKey: "other-session" }
        const timers = []
        const liveSockets = new Set([modern.socketId, legacy.socketId])
        const results = []
        const module = { exports: {} }
        const source = ts.transpileModule(fs.readFileSync("apps/room-api/socket/directCall/recovery.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
        }).outputText
        vm.runInNewContext(source, {
            module,
            exports: module.exports,
            console,
            require: (name) => {
                if (name === "./ownership")
                    return {
                        callActor: (socket) => (socket.actor.modern ? socket.actor : undefined),
                        mediaActor: (socket) => socket.actor
                    }
                if (name === "./redisService")
                    return {
                        callStore: {
                            ...store,
                            transition: async (...args) => {
                                const result = await store.transition(...args)
                                results.push(result)
                                return result
                            }
                        }
                    }
                if (name === "./callStore") return { CALL_RING_MS: 60_000 }
                if (name === "./instance") return require("../../apps/room-api/socket/directCall/instance.ts")
                if (name.endsWith("/ack")) return require("../../apps/shared/types/socket/ack.ts")
                throw new Error("Unexpected recovery dependency " + name)
            },
            setTimeout: (callback) => {
                const timer = { callback, cancelled: false, unref() {} }
                timers.push(timer)
                return timer
            },
            clearTimeout: (timer) => {
                timer.cancelled = true
            }
        })
        const register = (actor) => {
            const handlers = new Map()
            const socket = { id: actor.socketId, actor, on: (name, handler) => handlers.set(name, handler) }
            module.exports.registerDirectCallRecovery(
                {
                    socket,
                    user: { id: receiver },
                    io: { in: (id) => ({ fetchSockets: async () => (liveSockets.has(id) ? [{}] : []) }) }
                },
                {
                    getRoom: store.get,
                    getAllRooms: store.list,
                    roomPrefix: "call:room:",
                    getUserRoom: async (id) => {
                        const result = await store.current(id)
                        return result.roomId ? { key: "call:room:" + result.roomId, room: result.room } : null
                    },
                    notifyEnded: async () => {},
                    endCall: async () => {
                        throw new Error("Owned room used legacy user-wide cleanup")
                    }
                }
            )
            return handlers
        }
        const waitFor = async (predicate) => {
            for (let attempt = 0; attempt < 100; attempt++) {
                if (await predicate()) return
                await new Promise((resolve) => setTimeout(resolve, 5))
            }
            throw new Error("Recovery condition did not complete")
        }
        try {
            await Promise.all([modern, legacy, foreign].map(store.registerEndpoint))
            const reserved = await store.reserve(caller, receiver, true, modern, false)
            await store.transition(reserved.roomId, receiver, "accept", legacy)
            const original = register(legacy)
            liveSockets.delete(legacy.socketId)
            await store.disconnectEndpoint(legacy.socketId)
            original.get("disconnect")()
            await waitFor(() => timers.length === 2)
            liveSockets.add(foreign.socketId)
            register(foreign)
            assert.equal(
                (
                    await store.ownership(
                        reserved.roomId,
                        receiver,
                        "legacyAttach",
                        { ...foreign, previousSocket: legacy.socketId },
                        1
                    )
                ).kind,
                "forbidden"
            )
            for (const timer of timers) if (!timer.cancelled) timer.callback()
            await waitFor(() => results.length > 0)
            assert.equal(results[0].kind, "ended")
            assert.equal(await store.get(reserved.roomId), null)
            const next = await store.reserve(caller, receiver, true, modern, false)
            await store.transition(next.roomId, receiver, "accept", legacy)
            const second = register(legacy)
            const timerCount = timers.length
            second.get("disconnect")()
            await waitFor(() => timers.length === timerCount + 2)
            const reattached = {
                ...legacy,
                endpointKey: "deadline-reattached",
                socketId: "deadline-b3",
                previousSocket: legacy.socketId
            }
            await store.registerEndpoint(reattached)
            liveSockets.add(reattached.socketId)
            register(reattached)
            assert.equal((await store.ownership(next.roomId, receiver, "legacyAttach", reattached, 1)).kind, "existing")
            for (const timer of timers.slice(timerCount)) if (!timer.cancelled) timer.callback()
            await waitFor(() => results.length === 2)
            assert.equal(results[1].kind, "forbidden")
            assert.ok(await store.get(next.roomId))
            await store.disconnectEndpoint(reattached.socketId)
            await redis.del("call:endpoint:" + reattached.endpointKey)
        } finally {
            try {
                const current = await store.current(caller)
                if (current.roomId) await store.remove(current.roomId)
                for (const actor of [modern, legacy, foreign]) {
                    await store.disconnectEndpoint(actor.socketId)
                    await redis.del("call:endpoint:" + actor.endpointKey)
                }
            } finally {
                redis.disconnect()
            }
        }
    }
)

test(
    "a stale heartbeat refreshes the owner's state without disclosing it to outsiders",
    { skip: !url, timeout: 15_000 },
    async () => {
        const fs = require("node:fs")
        const vm = require("node:vm")
        const ts = require("typescript")
        const redis = new Redis(url, { maxRetriesPerRequest: 1, retryStrategy: () => null })
        redis.on("error", () => {})
        const store = createCallStore(redis)
        const caller = 910005,
            receiver = 910006
        const phone = { endpointKey: "heartbeat-phone", socketId: "heartbeat-a1", modern: true }
        const desktop = { endpointKey: "heartbeat-desktop", socketId: "heartbeat-a2", modern: true }
        const peer = { endpointKey: "heartbeat-peer", socketId: "heartbeat-b", modern: true }
        const events = [],
            handlers = new Map()
        const socket = {
            id: phone.socketId,
            data: {},
            handshake: { auth: { callProtocol: 3 } },
            on: (name, handler) => handlers.set(name, handler),
            emit: (name, payload) => events.push({ name, payload })
        }
        const loadCallModule = (filename) => {
            const module = { exports: {} }
            const source = ts.transpileModule(fs.readFileSync("apps/room-api/socket/directCall/" + filename, "utf8"), {
                compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
            }).outputText
            vm.runInNewContext(source, {
                module,
                exports: module.exports,
                console,
                require: (name) => {
                    if (name === "./ownership")
                        return {
                            callActor: () => phone,
                            mediaActor: () => phone,
                            mediaState: (room, uid, actor) => ({
                                active: room.owners[String(uid)].socketId === actor.socketId,
                                canClaim: true,
                                ownershipRevision: room.owners[String(uid)].ownershipRevision
                            })
                        }
                    if (name === "./redisService") return { callStore: store, getRoom: store.get }
                    if (name === "./instance") return require("../../apps/room-api/socket/directCall/instance.ts")
                    if (name.endsWith("/ack")) return require("../../apps/shared/types/socket/ack.ts")
                    throw new Error("Unexpected call dependency " + name)
                }
            })
            return module.exports
        }
        const { registerCallControl } = loadCallModule("control.ts")
        const { createCallState } = loadCallModule("state.ts")
        try {
            await Promise.all([phone, desktop, peer].map(store.registerEndpoint))
            const reserved = await store.reserve(caller, receiver, true, phone, true)
            await store.transition(reserved.roomId, receiver, "accept", peer)
            await store.ownership(reserved.roomId, caller, "claim", desktop, 1)
            await store.ownership(reserved.roomId, caller, "claim", phone, 2)
            const context = { socket, io: {}, user: { id: caller, username: "caller" } }
            const stateServices = {
                users: async () => [
                    { id: caller, username: "caller" },
                    { id: receiver, username: "receiver" }
                ],
                peerEventRoom: async (id) => String(id)
            }
            registerCallControl(context, stateServices, createCallState(context, stateServices), { scheduleExpiry() {} })
            await handlers.get("call:heartbeat")({ roomId: reserved.roomId, ownershipRevision: 1 })
            assert.equal(events.filter((event) => event.name === "call:ended").length, 0)
            const state = events.find((event) => event.name === "call:state")?.payload
            assert.equal(state.media.active, true)
            assert.equal(state.media.ownershipRevision, 3)
            assert.ok(await store.get(reserved.roomId))
            events.length = 0
            await handlers.get("call:heartbeat")({ roomId: reserved.roomId, ownershipRevision: 3 })
            assert.equal(events.length, 0)

            const outsider = { ...context, user: { id: 910007, username: "outsider" } }
            registerCallControl(outsider, stateServices, createCallState(outsider, stateServices), { scheduleExpiry() {} })
            await handlers.get("call:heartbeat")({ roomId: reserved.roomId, ownershipRevision: 3 })
            assert.equal(events.length, 0)
        } finally {
            try {
                const current = await store.current(caller)
                if (current.roomId) await store.remove(current.roomId)
                for (const actor of [phone, desktop, peer]) {
                    await store.disconnectEndpoint(actor.socketId)
                    await redis.del("call:endpoint:" + actor.endpointKey)
                }
            } finally {
                redis.disconnect()
            }
        }
    }
)
