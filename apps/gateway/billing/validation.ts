import { createHash, timingSafeEqual } from "node:crypto"
import { normalizeEmail } from "../../shared/auth/passwordPolicy"
import { isPaidPlan } from "./catalog"
import { CheckoutError, type CheckoutInput } from "./types"

export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
export const CAPABILITY = /^[A-Za-z0-9_-]{43}$/
export function digest(value: string): string {
    return createHash("sha256").update(value).digest("hex")
}

export function capabilityMatches(token: string, storedHash?: string): boolean {
    const expected = storedHash && /^[a-f0-9]{64}$/.test(storedHash) ? storedHash : "0".repeat(64)
    return timingSafeEqual(Buffer.from(digest(token), "hex"), Buffer.from(expected, "hex"))
}

export function parseCheckout(value: unknown): CheckoutInput {
    const body = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
    const username = typeof body.username === "string" ? body.username.trim() : ""
    const email = normalizeEmail(body.email)
    if (
        !isPaidPlan(body.planSlug) ||
        username.length < 3 ||
        username.length > 50 ||
        /\s/.test(username) ||
        Array.from(username).some((char) => char.charCodeAt(0) < 32) ||
        !email ||
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        typeof body.requestId !== "string" ||
        !UUID.test(body.requestId) ||
        typeof body.statusToken !== "string" ||
        !CAPABILITY.test(body.statusToken)
    ) {
        throw new CheckoutError(400, "invalid_checkout", "Укажите тариф, никнейм и email существующего аккаунта.")
    }
    return {
        planSlug: body.planSlug,
        username,
        email,
        requestId: body.requestId.toLowerCase(),
        statusToken: body.statusToken
    }
}

export function checkoutFingerprint(input: CheckoutInput): string {
    return digest(JSON.stringify([input.planSlug, input.username, input.email]))
}

export function safeConfirmationUrl(value: unknown): string | null {
    if (typeof value !== "string" || value.length > 4096) return null
    try {
        const url = new URL(value)
        return url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            !url.port &&
            ["yoomoney.ru", "yookassa.ru"].includes(url.hostname)
            ? url.href
            : null
    } catch {
        return null
    }
}
