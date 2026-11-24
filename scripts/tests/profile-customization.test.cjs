const { test, mock } = require("node:test")
const assert = require("node:assert/strict")
require("tsx/cjs")

const depsPath = require.resolve("../../apps/shared/deps.ts")
const query = mock.fn()
require.cache[depsPath] = { id: depsPath, filename: depsPath, loaded: true, exports: { pool: { query } } }
const registerProfile = require("../../apps/chat-api/socket/profile.ts").default

function setup(plan = "pro") {
    query.mock.resetCalls()
    query.mock.mockImplementation(async (sql) => {
        if (sql.includes("FROM user_subscriptions")) return { rows: [{ plan_slug: plan }] }
        if (sql.includes("FROM friendships")) return { rows: [{ id: 2 }, { id: 3 }] }
        return { rows: [], rowCount: 1 }
    })
    const handlers = new Map()
    const emit = mock.fn()
    const to = mock.fn(() => ({ emit }))
    registerProfile({
        socket: { on: (event, handler) => handlers.set(event, handler) },
        io: { to },
        user: { id: 1, username: "alex" }
    })
    return {
        update: handlers.get("profile:update"),
        get: handlers.get("profile:get"),
        avatars: handlers.get("profile:friendsAvatars"),
        getKey: handlers.get("profile:getDmPublicKey"),
        setKey: handlers.get("profile:setDmPublicKey"),
        to,
        emit
    }
}

for (const payload of [
    { status: "На связи", bio: "Привет" },
    {
        status: "На связи",
        bio: "Привет",
        profileAvatarEffect: "prism",
        profileBannerEffect: "sakura",
        profileBannerSticker: "ghost"
    },
    { status: "", bio: "", avatar: "", profileBanner: "", profileBannerEffect: "none", profileBannerSticker: "none" }
]) {
    test(`saved profile invalidates the owner and accepted friends: ${Object.keys(payload).join(", ")}`, async () => {
        const { update, to, emit } = setup()
        const ack = mock.fn()
        await update(payload, ack)
        await new Promise(setImmediate)
        assert.deepEqual(
            ack.mock.calls.map((call) => call.arguments),
            [[{ success: true }]]
        )
        assert.deepEqual(
            to.mock.calls.map((call) => call.arguments),
            [[["1", "2", "3"]]]
        )
        assert.deepEqual(emit.mock.calls[0].arguments, ["profile:updated", { username: "alex", userId: 1 }])
        const audienceQuery = query.mock.calls.find((call) => call.arguments[0].includes("FROM friendships"))
        assert.match(audienceQuery.arguments[0], /status = 'accepted'/)
        assert.deepEqual(audienceQuery.arguments[1], [1])
    })
}

test("rejected appearance does not publish an update", async () => {
    const { update, emit } = setup()
    const ack = mock.fn()
    await update({ profileAvatarEffect: "unknown-effect" }, ack)
    await new Promise(setImmediate)
    assert.equal(ack.mock.calls[0].arguments[0].success, false)
    assert.equal(emit.mock.callCount(), 0)
    assert.equal(
        query.mock.calls.some((call) => call.arguments[0].startsWith("UPDATE")),
        false
    )
})

test("profile edits preserve omitted appearance fields and only update the owner", async () => {
    const { update } = setup()
    const ack = mock.fn()
    await update({ userId: 2, username: "mira", status: " Здесь ", avatar: null, profileBannerSticker: "none" }, ack)
    const save = query.mock.calls.find((call) => call.arguments[0].startsWith("UPDATE"))
    assert.deepEqual(save.arguments, [
        "UPDATE users SET profile_status = $1, profile_bio = $2, profile_avatar = $3, profile_banner_sticker = $4 WHERE id = $5",
        ["Здесь", "", null, "none", 1]
    ])
    assert.deepEqual(ack.mock.calls[0].arguments, [{ success: true }])
})

test("a notification failure does not turn a saved profile into a failed save", async () => {
    const { update, emit } = setup()
    query.mock.mockImplementation(async (sql) => {
        if (sql.includes("FROM friendships")) throw new Error("notification unavailable")
        return { rows: [], rowCount: 1 }
    })
    const log = mock.method(console, "error", () => {})
    const ack = mock.fn()
    try {
        await update({ status: "На связи" }, ack)
        await new Promise(setImmediate)
        assert.deepEqual(
            ack.mock.calls.map((call) => call.arguments),
            [[{ success: true }]]
        )
        assert.equal(emit.mock.callCount(), 0)
        assert.equal(log.mock.callCount(), 1)
    } finally {
        log.mock.restore()
    }
})

for (const [plan, patch, expected] of [
    ["free", { profileAvatarEffect: "halo" }, true],
    ["free", { profileAvatarEffect: "orbit" }, true],
    ["free", { profileBannerEffect: "glow" }, true],
    ["free", { profileAvatarEffect: "bloom" }, false],
    ["free", { profileBannerEffect: "snow" }, false],
    ["free", { profileBanner: "data:image/png;base64,AAAA" }, false],
    ["free", { profileBannerSticker: "fire" }, false],
    ["medium", { profileAvatarEffect: "bloom", profileBannerEffect: "glow" }, true],
    ["medium", { profileBannerEffect: "sakura" }, false],
    ["pro", { profileBannerEffect: "glow" }, true],
    ["pro", { profileBannerEffect: "ember", profileBannerSticker: "fire" }, true]
]) {
    test(`${plan}: ${JSON.stringify(patch)} is ${expected ? "saved" : "rejected by the server"}`, async () => {
        const f = setup(plan)
        const ack = mock.fn()
        await f.update(patch, ack)
        await new Promise(setImmediate)
        assert.equal(ack.mock.calls[0].arguments[0].success, expected)
        assert.equal(
            query.mock.calls.some((call) => call.arguments[0].startsWith("UPDATE")),
            expected
        )
    })
}

test("a friend's Free profile preserves the allowed avatar and light banner effect without exposing a paid banner", async () => {
    const f = setup("free")
    query.mock.mockImplementation(async (sql) => {
        if (sql.includes("FROM user_subscriptions")) return { rows: [{ plan_slug: "free" }] }
        if (sql.includes("FROM friendships")) return { rows: [{ id: 2 }] }
        return {
            rows: [
                {
                    id: 2,
                    username: "mira",
                    email: "private@example.test",
                    profile_avatar_effect: "orbit",
                    profile_banner_effect: "glow",
                    profile_banner_sticker: "fire",
                    profile_banner: "paid-image",
                    created_at: new Date()
                }
            ]
        }
    })
    const ack = mock.fn()
    await f.get({ username: "mira" }, ack)
    const profile = ack.mock.calls[0].arguments[0].profile
    assert.equal(profile.profileAvatarEffect, "orbit")
    assert.equal(profile.profileBannerEffect, "glow")
    assert.equal(profile.profileBanner, null)
    assert.equal(profile.profileBannerSticker, "none")
    assert.equal(profile.email, undefined)
})

test("friend and call avatar data applies each owner's allowed effects", async () => {
    const f = setup("free")
    query.mock.mockImplementation(async (sql) => {
        if (sql.includes("JOIN users"))
            return {
                rows: [
                    { username: "mira", profile_avatar_effect: "orbit", plan_slug: "free" },
                    { username: "neo", profile_avatar_effect: "bloom", plan_slug: "free" }
                ]
            }
        if (sql.includes("FROM user_subscriptions")) return { rows: [{ plan_slug: "free" }] }
        return { rows: [{ username: "alex", profile_avatar_effect: "halo" }] }
    })
    const ack = mock.fn()
    await f.avatars({}, ack)
    const profiles = ack.mock.calls[0].arguments[0]
    assert.equal(profiles.mira.profileAvatarEffect, "orbit")
    assert.equal(profiles.neo.profileAvatarEffect, "none")
    assert.equal(profiles.alex.profileAvatarEffect, "halo")
})

test("a guest profile hides its internal email and exposes registration state only to its owner", async () => {
    const f = setup("free")
    const publicKey = Buffer.alloc(32, 1).toString("base64")
    let self = true
    query.mock.mockImplementation(async (sql) => {
        if (sql.includes("FROM user_subscriptions")) return { rows: [{ plan_slug: "free" }] }
        if (sql.includes("FROM friendships")) return { rows: [{ id: 2 }] }
        return {
            rows: [
                {
                    id: self ? 1 : 2,
                    username: "guest",
                    email: "private@guest.playtime.invalid",
                    is_guest: true,
                    guest_registration_pending: false,
                    dm_public_key: publicKey,
                    created_at: new Date()
                }
            ]
        }
    })
    const ack = mock.fn()
    await f.get({}, ack)
    const own = ack.mock.calls[0].arguments[0].profile
    assert.equal(own.email, undefined)
    assert.equal(own.isGuest, true)
    assert.equal(own.registrationPending, false)
    assert.equal(own.dmPublicKey, publicKey)
    self = false
    await f.get({ username: "guest" }, ack)
    const friend = ack.mock.calls[1].arguments[0].profile
    assert.equal(friend.email, undefined)
    assert.equal(friend.isGuest, undefined)
    assert.equal(friend.registrationPending, undefined)
    assert.equal(friend.dmPublicKey, undefined)
})

for (const peerUserId of [null, "2", 0, -1, 1.5, Number.NaN, {}]) {
    for (const username of [undefined, "mira"]) {
        test(`profile:get rejects malformed stable ID ${String(peerUserId)} with username ${String(username)} without any fallback query`, async () => {
            const f = setup()
            const ack = mock.fn()
            await f.get({ peerUserId, username }, ack)
            assert.equal(query.mock.callCount(), 0)
            assert.deepEqual(
                ack.mock.calls.map((call) => call.arguments),
                [[{ err: "Пользователь не найден" }]]
            )
        })
    }
}

test("a public key is visible to an accepted contact using a stable user ID", async () => {
    const { getKey } = setup()
    const publicKey = Buffer.alloc(32, 1).toString("base64")
    let areFriends = false
    query.mock.mockImplementation(async (sql) => {
        if (sql.includes("FROM friendships")) return { rows: areFriends ? [{}] : [] }
        if (sql.includes("dm_public_key")) return { rows: [{ id: 2, dm_public_key: publicKey }] }
        return { rows: [{ id: 2, username: "mira", guest_archived_at: new Date() }] }
    })
    const ack = mock.fn()
    await getKey({ peerUserId: 2, username: "reclaimed" }, ack)
    areFriends = true
    await getKey({ peerUserId: 2, username: "reclaimed" }, ack)
    assert.deepEqual(
        ack.mock.calls.map((call) => call.arguments[0]),
        [{ err: "Доступно только друзьям" }, { publicKey }]
    )
    assert.deepEqual(
        query.mock.calls.map((call) => call.arguments[1]),
        [[2], [2], [1, 2], [2], [2], [1, 2]]
    )
})

test("clearing or overriding a public key requires explicit confirmation and only updates the owner", async () => {
    const { setKey } = setup()
    const publicKey = Buffer.alloc(32, 1).toString("base64")
    const ack = mock.fn()
    query.mock.mockImplementation(async (sql, values) => ({
        rowCount: sql.includes("dm_public_key = NULL") || values[2] === true ? 1 : 0
    }))
    await setKey({ publicKey: null, replaceExisting: "true" }, ack)
    await setKey({ publicKey, userId: 2 }, ack)
    await setKey({ publicKey, userId: 2, replaceExisting: true }, ack)
    await setKey({ publicKey: "", userId: 2, replaceExisting: true }, ack)
    assert.deepEqual(
        ack.mock.calls.map((call) => call.arguments[0]),
        [
            { success: false, err: "Подтвердите замену ключа" },
            { success: false, err: "Ключ аккаунта уже изменился на другом устройстве. Восстановите копию ключей." },
            { success: true },
            { success: true }
        ]
    )
    assert.match(query.mock.calls[0].arguments[0], /dm_public_key IS NULL OR dm_public_key = \$1 OR \$3::boolean/)
    assert.match(query.mock.calls[2].arguments[0], /SET dm_public_key = NULL/)
    assert.deepEqual(
        query.mock.calls.map((call) => call.arguments[1]),
        [[publicKey, 1, false], [publicKey, 1, true], [1]]
    )
})
