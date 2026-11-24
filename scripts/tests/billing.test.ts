import assert from "node:assert/strict"
import { randomBytes, randomUUID } from "node:crypto"
import { test } from "node:test"
import { effectivePaidPlans } from "../../apps/database/subscriptionPlans"
import { addCalendarMonth } from "../../apps/gateway/billing/entitlements"
import { billingPlans } from "../../apps/gateway/billing/catalog"
import { readBillingConfig } from "../../apps/gateway/billing/config"
import { capabilityMatches, digest, parseCheckout, safeConfirmationUrl } from "../../apps/gateway/billing/validation"
import { verifiedPayment } from "../../apps/gateway/billing/paymentValidation"
import { YooKassaProvider } from "../../apps/gateway/billing/yookassa"
import type { BillingConfig, OrderRow, PaymentRequest } from "../../apps/gateway/billing/types"
import { readBillingScope } from "../../apps/shared/subscription/billingScope"

const config: BillingConfig = {
    mode: "test",
    shopId: "12345",
    secretKey: "test_isolated-not-real-secret",
    returnUrl: "https://shop.example.test/playtime/checkout"
}
const id = randomUUID()
const request: PaymentRequest = {
    amount: { value: "100.00", currency: "RUB" },
    capture: true,
    confirmation: { type: "redirect", return_url: "https://shop.example.test/playtime/checkout?order=" + id },
    description: "PlayTime Medium",
    metadata: { order_id: id, user_id: "1", plan_slug: "medium" }
}
const order = {
    id,
    user_id: 1,
    shop_id: config.shopId,
    mode: "test",
    provider_id: null,
    plan_slug: "medium",
    amount_minor: 10000,
    currency: "RUB",
    provider_request: request
} as OrderRow
const payment = () => ({
    id: randomUUID(),
    status: "pending",
    paid: false,
    test: true,
    amount: request.amount,
    recipient: { account_id: config.shopId },
    metadata: request.metadata,
    confirmation: {
        type: "redirect",
        confirmation_url: "https://yoomoney.ru/checkout/payments/v2/contract?orderId=fixture"
    }
})

test("checkout uses an existing-account pair and bounded opaque proofs, never client prices or IDs", () => {
    const token = randomBytes(32).toString("base64url")
    const input = {
        planSlug: "medium",
        username: " alex ",
        email: " ALEX@EXAMPLE.TEST ",
        requestId: randomUUID(),
        statusToken: token,
        amount: "0.01",
        userId: 900
    }
    assert.deepEqual(parseCheckout(input), {
        planSlug: "medium",
        username: "alex",
        email: "alex@example.test",
        requestId: input.requestId,
        statusToken: token
    })
    for (const change of [
        { planSlug: "free" },
        { statusToken: "short" },
        { requestId: "1" },
        { username: "a b" },
        { username: "a\u0001b" },
        { email: "missing" }
    ])
        assert.throws(() => parseCheckout({ ...input, ...change }))
    assert(capabilityMatches(token, digest(token)))
    assert(!capabilityMatches(randomBytes(32).toString("base64url"), digest(token)))
    assert(!capabilityMatches(token))
    assert.deepEqual(
        billingPlans().map((plan) => plan.amount),
        [
            { value: "100.00", currency: "RUB" },
            { value: "200.00", currency: "RUB" },
            { value: "500.00", currency: "RUB" }
        ]
    )
})

test("billing defaults off and each explicit mode requires matching credentials and a trusted return origin", () => {
    const env = {
        YOOKASSA_MODE: "test",
        YOOKASSA_SHOP_ID: config.shopId,
        YOOKASSA_SECRET_KEY: config.secretKey,
        SITE_ORIGIN: "https://shop.example.test",
        NODE_ENV: "production"
    }
    assert.equal(readBillingConfig(env)?.mode, "test")
    assert.equal(readBillingConfig(env)?.returnUrl, "https://shop.example.test/playtime/checkout")
    assert.deepEqual(readBillingScope(env), { mode: "test", shopId: config.shopId })
    const live = { ...env, YOOKASSA_MODE: "live", YOOKASSA_SECRET_KEY: "live_isolated-not-real-secret" }
    assert.equal(readBillingConfig(live)?.mode, "live")
    assert.deepEqual(readBillingScope(live), { mode: "live", shopId: config.shopId })
    assert.equal(readBillingConfig({ ...live, YOOKASSA_SECRET_KEY: config.secretKey }), null)
    assert.equal(readBillingConfig({ ...live, SITE_ORIGIN: "http://localhost", NODE_ENV: "development" }), null)
    assert.equal(readBillingConfig({ ...live, YOOKASSA_MODE: undefined }), null)
    for (const change of [
        { YOOKASSA_MODE: "live" },
        { YOOKASSA_MODE: "" },
        { YOOKASSA_SECRET_KEY: "" },
        { YOOKASSA_SECRET_KEY: "test_" },
        { YOOKASSA_SECRET_KEY: "live_isolated-wrong-profile" },
        { YOOKASSA_SECRET_KEY: "unknown-prefix-is-disabled" },
        { YOOKASSA_SHOP_ID: "abc" },
        { SITE_ORIGIN: "http://shop.example.test" },
        { SITE_ORIGIN: "https://user:secret@shop.example.test" },
        { SITE_ORIGIN: "https://shop.example.test/other" }
    ]) {
        assert.equal(readBillingConfig({ ...env, ...change }), null)
        assert.equal(readBillingScope({ ...env, ...change }), null)
    }
    assert.equal(readBillingScope({ ...env, SITE_PUBLIC_PATH: "//bad:port" }), null)
    assert.deepEqual(readBillingScope({ ...env, SITE_ORIGIN: "http://[::1]:8000", NODE_ENV: "development" }), {
        mode: "test",
        shopId: config.shopId
    })
})

test("live verification rejects test, absent or ambiguous mode and preserves all payment bindings", () => {
    const liveOrder = { ...order, mode: "live" as const }
    const livePayment = { ...payment(), test: false, status: "succeeded", paid: true, confirmation: undefined }
    assert(verifiedPayment(livePayment, liveOrder))
    for (const test of [true, undefined, null, "false", 0]) {
        assert.equal(verifiedPayment({ ...livePayment, test }, liveOrder), null)
    }
    assert.equal(verifiedPayment(livePayment, order), null)
    for (const change of [
        { amount: { value: "0.01", currency: "RUB" } },
        { recipient: { account_id: "another-live-shop" } },
        { metadata: { ...request.metadata, user_id: "2" } },
        { metadata: { ...request.metadata, order_id: randomUUID() } },
        { metadata: { ...request.metadata, plan_slug: "enterprise" } }
    ])
        assert.equal(verifiedPayment({ ...livePayment, ...change }, liveOrder), null)
})

test("confirmation redirects stay on exact HTTPS provider hosts", () => {
    assert(safeConfirmationUrl("https://yoomoney.ru/checkout/payments/v2/contract?orderId=fixture"))
    assert(safeConfirmationUrl("https://yookassa.ru/checkout"))
    for (const url of [
        "javascript:alert(1)",
        "http://yoomoney.ru/",
        "https://yoomoney.ru.evil.test/",
        "https://evil.yoomoney.ru/",
        "https://user:secret@yoomoney.ru/",
        "https://yoomoney.ru:444/"
    ])
        assert.equal(safeConfirmationUrl(url), null)
})

test("one calendar month clamps end-of-month and preserves UTC time", () => {
    for (const [from, until] of [
        ["2025-01-31T13:14:15.123Z", "2025-02-28T13:14:15.123Z"],
        ["2024-01-31T13:14:15.123Z", "2024-02-29T13:14:15.123Z"],
        ["2025-12-31T13:14:15.123Z", "2026-01-31T13:14:15.123Z"]
    ])
        assert.equal(addCalendarMonth(new Date(from)).toISOString(), until)
})

test("one paid-plan query covers 1000 friends plus self and preserves stronger manual plans", async () => {
    let calls = 0
    const now = new Date("2026-11-10T00:00:00.000Z")
    const accounts = Array.from({ length: 1001 }, (_, index) => ({
        id: index + 1,
        manual: index === 1000 ? ("pro" as const) : ("free" as const)
    }))
    const db = {
        query: async (sql: string, values: unknown[]) => {
            calls++
            assert(sql.includes("user_id=ANY($1::int[])"))
            assert.equal((values[0] as number[]).length, 1001)
            assert.equal(values[1], "test")
            assert.equal(values[2], config.shopId)
            assert.equal(values[3], now)
            return {
                rows: [
                    { user_id: 42, plan_slug: "enterprise" },
                    { user_id: 999, plan_slug: "medium" },
                    { user_id: 1001, plan_slug: "medium" },
                    { user_id: 2000, plan_slug: "enterprise" }
                ]
            }
        }
    } as unknown as Parameters<typeof effectivePaidPlans>[1]
    const plans = await effectivePaidPlans(accounts, db, config, now)
    assert.equal(calls, 1)
    assert.equal(plans.size, 1001)
    assert.equal(plans.get(42), "enterprise")
    assert.equal(plans.get(999), "medium")
    assert.equal(plans.get(1001), "pro")
    assert.equal(plans.get(2000), undefined)
    calls = 0
    assert.equal((await effectivePaidPlans(accounts, db, null, now)).get(42), "free")
    assert.equal((await effectivePaidPlans([], db, config, now)).size, 0)
    assert.equal(calls, 0)
})

test("provider verification binds amount, currency, test shop, opaque order, account and plan", () => {
    assert(verifiedPayment(payment(), order, true))
    const good = payment()
    for (const change of [
        { test: false },
        { amount: { value: "0.01", currency: "RUB" } },
        { amount: { value: "100.00", currency: "USD" } },
        { recipient: { account_id: "another" } },
        { metadata: { ...request.metadata, order_id: randomUUID() } },
        { metadata: { ...request.metadata, user_id: "2" } },
        { metadata: { ...request.metadata, plan_slug: "pro" } },
        { status: "succeeded", paid: false },
        { status: "canceled", paid: true },
        { confirmation: { confirmation_url: "https://evil.test" } }
    ])
        assert.equal(verifiedPayment({ ...good, ...change }, order, true), null)
    assert.equal(verifiedPayment(good, { ...order, provider_id: randomUUID() }), null)
    assert.equal(verifiedPayment({ type: "error", code: "invalid_credentials" }, order), null)
    assert(verifiedPayment({ ...good, status: "succeeded", paid: true, confirmation: undefined }, order))
})

test("provider HTTP transport fixes origin, auth and idempotence, and rejects unsafe responses", async () => {
    const seen: { url: string; init: NonNullable<Parameters<typeof fetch>[1]> }[] = []
    const fetcher = (async (url, init) => {
        seen.push({ url: String(url), init: init! })
        return Response.json(payment())
    }) as typeof fetch
    const provider = new YooKassaProvider(config, fetcher)
    await provider.create(request, id)
    await provider.get(id)
    assert.equal(seen[0].url, "https://api.yookassa.ru/v3/payments")
    assert.equal(seen[1].url, "https://api.yookassa.ru/v3/payments/" + id)
    assert.equal(seen[0].init.redirect, "error")
    const headers = seen[0].init.headers as Record<string, string>
    assert.equal(headers["Idempotence-Key"], id)
    assert.equal(
        headers.Authorization,
        "Basic " + Buffer.from(config.shopId + ":" + config.secretKey).toString("base64")
    )
    assert.deepEqual(JSON.parse(String(seen[0].init.body)), request)
    for (const response of [
        new Response("HTML", { headers: { "content-type": "text/html" } }),
        new Response("private-provider-body", { status: 500 }),
        new Response("malformed-private-body", { headers: { "content-type": "application/json" } }),
        new Response("x".repeat(65537), { headers: { "content-type": "application/json" } })
    ]) {
        const client = new YooKassaProvider(config, (async () => response) as typeof fetch)
        await assert.rejects(
            client.create(request, id),
            (error) => error instanceof Error && !error.message.includes("private")
        )
    }
    await assert.rejects(provider.get("https://evil.test"))
})

test("a stalled provider response is bounded by its eight-second deadline", { timeout: 10000 }, async () => {
    const fetcher = ((_url, init) =>
        new Promise((_resolve, reject) =>
            init!.signal!.addEventListener("abort", () => reject(new Error("deadline")), { once: true })
        )) as typeof fetch
    const start = Date.now()
    await assert.rejects(new YooKassaProvider(config, fetcher).create(request, id))
    assert(Date.now() - start >= 7500 && Date.now() - start < 9500)
})
