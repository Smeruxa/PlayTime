import type { BillingProfile, BillingScope } from "../../shared/subscription/billingScope"

export type PaidPlanSlug = "medium" | "pro" | "enterprise"
export type BillingMode = BillingScope["mode"]
export type OrderState = "creating" | "pending" | "succeeded" | "canceled" | "review"

export type BillingPlan = {
    slug: PaidPlanSlug
    displayName: string
    amount: { value: string; currency: "RUB" }
    periodMonths: 1
}

export type CheckoutInput = {
    planSlug: PaidPlanSlug
    username: string
    email: string
    requestId: string
    statusToken: string
}

export type PaymentRequest = {
    amount: { value: string; currency: "RUB" }
    capture: true
    confirmation: { type: "redirect"; return_url: string }
    description: string
    metadata: { order_id: string; user_id: string; plan_slug: PaidPlanSlug }
}

export type BillingConfig = BillingProfile

export type OrderRow = {
    id: string
    request_id: string
    capability_hash: string
    request_hash: string
    request_ip_hash: string
    user_id: number | null
    username_snapshot: string
    mode: BillingMode
    shop_id: string
    plan_slug: PaidPlanSlug
    amount_minor: number
    currency: "RUB"
    provider_request: PaymentRequest
    provider_id: string | null
    confirmation_url: string | null
    state: OrderState
    created_at: Date
    access_expires_at: Date
    create_deadline: Date
    next_check_at: Date
    lease_token: string | null
    lease_until: Date | null
    attempts: number
    last_error_code: string | null
}

export type CheckoutOrder = {
    orderId: string
    mode: BillingMode
    status: OrderState | "expired"
    plan: BillingPlan
    account: { username: string }
    confirmationUrl: string | null
    pollAfterMs: number
    accessExpiresAt: string
    grant: {
        applied: true
        planSlug: PaidPlanSlug
        validFrom: string
        validUntil: string
        effectivePlanSlug: string
    } | null
}

export interface PaymentProvider {
    create(request: PaymentRequest, idempotenceKey: string): Promise<unknown>
    get(paymentId: string): Promise<unknown>
}

export class CheckoutError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string
    ) {
        super(message)
    }
}
