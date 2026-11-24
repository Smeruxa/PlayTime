import { isPaidPlanSlug } from "./billingApi"
import type { CheckoutAttempt, CheckoutRequest, CheckoutStatus } from "./types"

const key = "playtime_checkout_attempts_v1"
const accessDuration = 7 * 24 * 60 * 60 * 1000
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const token = /^[A-Za-z0-9_-]{43}$/
const terminal: CheckoutStatus[] = ["succeeded", "canceled", "expired"]
function validAttempt(value: unknown): value is CheckoutAttempt {
    if (typeof value !== "object" || value === null) return false
    const row = value as Partial<CheckoutAttempt>
    return (
        isPaidPlanSlug(row.planSlug) &&
        typeof row.username === "string" &&
        typeof row.email === "string" &&
        typeof row.requestId === "string" &&
        uuid.test(row.requestId) &&
        typeof row.statusToken === "string" &&
        token.test(row.statusToken) &&
        typeof row.createdAt === "number" &&
        Number.isFinite(row.createdAt) &&
        row.createdAt + accessDuration > Date.now() &&
        (row.retryAt === undefined ||
            (typeof row.retryAt === "number" && Number.isFinite(row.retryAt))) &&
        (row.orderId === undefined || (typeof row.orderId === "string" && uuid.test(row.orderId)))
    )
}
export function readAttempts(): CheckoutAttempt[] {
    try {
        const values: unknown = JSON.parse(sessionStorage.getItem(key) ?? "[]")
        return Array.isArray(values) ? values.filter(validAttempt) : []
    } catch {
        return []
    }
}
export function saveAttempt(attempt: CheckoutAttempt): void {
    const attempts = readAttempts().filter((previous) => previous.requestId !== attempt.requestId)
    attempts.push(attempt)
    try {
        sessionStorage.setItem(key, JSON.stringify(attempts.slice(-20)))
    } catch {
        throw new Error("Разрешите сохранение данных сайта в браузере, чтобы продолжить оплату.")
    }
}
export function restoreAttempt(
    orderId: string | null,
    planSlug: string | null
): CheckoutAttempt | null {
    const attempts = readAttempts()
    if (orderId) return attempts.find((attempt) => attempt.orderId === orderId) ?? null
    return (
        attempts
            .reverse()
            .find(
                (attempt) =>
                    (!planSlug || attempt.planSlug === planSlug) &&
                    (!attempt.status || !terminal.includes(attempt.status))
            ) ?? null
    )
}
export function newAttempt(
    form: Pick<CheckoutRequest, "planSlug" | "username" | "email">
): CheckoutAttempt {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const statusToken = btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "")
    return { ...form, requestId: crypto.randomUUID(), statusToken, createdAt: Date.now() }
}
export function checkoutRequest(attempt: CheckoutAttempt): CheckoutRequest {
    const { planSlug, username, email, requestId, statusToken } = attempt
    return { planSlug, username, email, requestId, statusToken }
}

export function forgetAttempt(requestId: string): void {
    sessionStorage.setItem(
        key,
        JSON.stringify(readAttempts().filter((attempt) => attempt.requestId !== requestId))
    )
}
