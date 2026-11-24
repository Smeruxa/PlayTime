export type PaidPlanSlug = "medium" | "pro" | "enterprise"
export type BillingMode = "test" | "live"
export type CheckoutStatus =
    | "creating"
    | "pending"
    | "succeeded"
    | "canceled"
    | "review"
    | "expired"
export type BillingPlan = {
    slug: PaidPlanSlug
    displayName: string
    amount: { value: string; currency: "RUB" }
    periodMonths: 1
}
export type BillingCatalog = { enabled: boolean; mode: BillingMode | null; plans: BillingPlan[] }
export type CheckoutRequest = {
    planSlug: PaidPlanSlug
    username: string
    email: string
    requestId: string
    statusToken: string
}
export type CheckoutAttempt = CheckoutRequest & {
    createdAt: number
    orderId?: string
    status?: CheckoutStatus
    retryAt?: number
    accessExpiresAt?: string
}
export type CheckoutOrder = {
    orderId: string
    mode: BillingMode
    status: CheckoutStatus
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
        effectivePlanSlug: "free" | PaidPlanSlug
    } | null
}
