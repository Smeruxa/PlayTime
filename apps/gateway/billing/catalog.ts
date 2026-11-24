import type { BillingPlan, PaidPlanSlug } from "./types"

export function isPaidPlan(value: unknown): value is PaidPlanSlug {
    return value === "medium" || value === "pro" || value === "enterprise"
}

export function amountMinor(plan: PaidPlanSlug): number {
    return plan === "medium" ? 10000 : plan === "pro" ? 20000 : 50000
}

export function formatAmount(minor: number): string {
    return (minor / 100).toFixed(2)
}

export function billingPlan(slug: PaidPlanSlug): BillingPlan {
    return {
        slug,
        displayName: slug === "medium" ? "Medium" : slug === "pro" ? "Pro" : "Enterprise",
        amount: { value: formatAmount(amountMinor(slug)), currency: "RUB" },
        periodMonths: 1
    }
}

export function billingPlans(): BillingPlan[] {
    return [billingPlan("medium"), billingPlan("pro"), billingPlan("enterprise")]
}
