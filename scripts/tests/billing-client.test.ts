import assert from "node:assert/strict"
import { test } from "node:test"
import { parseCatalog, parseOrder } from "../../apps/site/src/billing/billingApi"

const plan = { slug: "pro", displayName: "Pro", amount: { value: "200.00", currency: "RUB" }, periodMonths: 1 }
const order = {
    orderId: "11111111-1111-4111-8111-111111111111",
    mode: "live",
    status: "pending",
    plan,
    account: { username: "alex" },
    confirmationUrl: "https://yoomoney.ru/checkout/fixture",
    pollAfterMs: 3000,
    accessExpiresAt: "2026-12-01T00:00:00Z",
    grant: null
}

test("checkout accepts both explicit modes and rejects ambiguous catalog or order mode", () => {
    for (const mode of ["test", "live"]) {
        assert.equal(parseCatalog({ enabled: true, mode, plans: [plan] }).mode, mode)
        assert.equal(parseOrder({ ...order, mode }).mode, mode)
    }
    assert.equal(parseCatalog({ enabled: false, mode: null, plans: [plan] }).enabled, false)
    for (const mode of [undefined, null, "production", false]) {
        assert.throws(() => parseCatalog({ enabled: true, mode, plans: [plan] }))
        assert.throws(() => parseOrder({ ...order, mode }))
    }
})

test("a live payment success without a server grant remains unconfirmed", () => {
    assert.throws(() => parseOrder({ ...order, status: "succeeded" }))
    const granted = parseOrder({
        ...order,
        status: "succeeded",
        confirmationUrl: null,
        grant: {
            applied: true,
            planSlug: "pro",
            validFrom: "2026-11-12T00:00:00Z",
            validUntil: "2026-12-12T00:00:00Z",
            effectivePlanSlug: "pro"
        }
    })
    assert.equal(granted.grant?.planSlug, "pro")
})
