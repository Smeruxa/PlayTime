import { getApiBase } from "../config/apiBase"
import type {
    BillingCatalog,
    BillingPlan,
    CheckoutOrder,
    CheckoutRequest,
    CheckoutStatus,
    PaidPlanSlug,
} from "./types"

const statuses: CheckoutStatus[] = [
    "creating",
    "pending",
    "succeeded",
    "canceled",
    "review",
    "expired",
]
const messages: Record<string, string> = {
    login_required: "Войдите в веб-приложение PlayTime и вернитесь к оплате.",
    account_ineligible: "Для оплаты нужен аккаунт с подтверждённой почтой.",
    order_not_found: "Заказ недоступен. Откройте оплату в исходной вкладке браузера.",
    invalid_checkout: "Проверьте тариф, никнейм и почту.",
    account_not_found: "Не удалось найти аккаунт с таким никнеймом и почтой. Проверьте оба поля.",
    checkout_conflict: "У вас уже есть начатая оплата. Продолжите её в исходной вкладке.",
    rate_limited: "Слишком много попыток. Подождите немного и попробуйте снова.",
    billing_unavailable: "Оплата временно недоступна. Попробуйте позже.",
}
export class BillingError extends Error {
    readonly code: string
    readonly retryAfterMs: number
    constructor(code: string, retryAfterMs = 0) {
        super(
            messages[code] ??
                "Не удалось открыть оплату. Проверьте подключение к интернету и попробуйте снова."
        )
        this.code = code
        this.retryAfterMs = retryAfterMs
    }
}
const record = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null
export function isPaidPlanSlug(value: unknown): value is PaidPlanSlug {
    return value === "medium" || value === "pro" || value === "enterprise"
}
function isPlan(value: unknown): value is BillingPlan {
    return (
        record(value) &&
        isPaidPlanSlug(value.slug) &&
        typeof value.displayName === "string" &&
        record(value.amount) &&
        typeof value.amount.value === "string" &&
        /^\d+\.\d{2}$/.test(value.amount.value) &&
        Number.isFinite(Number(value.amount.value)) &&
        Number(value.amount.value) > 0 &&
        value.amount.currency === "RUB" &&
        value.periodMonths === 1
    )
}
const validDate = (value: unknown): value is string =>
    typeof value === "string" && Number.isFinite(Date.parse(value))
export function parseCatalog(value: unknown): BillingCatalog {
    if (
        !record(value) ||
        typeof value.enabled !== "boolean" ||
        (value.mode !== null && value.mode !== "test" && value.mode !== "live") ||
        (value.enabled && value.mode === null) ||
        !Array.isArray(value.plans) ||
        !value.plans.every(isPlan) ||
        new Set(value.plans.map((plan) => plan.slug)).size !== value.plans.length
    ) {
        throw new BillingError("invalid_response")
    }
    return { enabled: value.enabled, mode: value.mode, plans: value.plans }
}
export function parseOrder(value: unknown): CheckoutOrder {
    if (
        !record(value) ||
        typeof value.orderId !== "string" ||
        (value.mode !== "test" && value.mode !== "live") ||
        !statuses.includes(value.status as CheckoutStatus) ||
        !isPlan(value.plan) ||
        !record(value.account) ||
        typeof value.account.username !== "string" ||
        !value.account.username ||
        (value.confirmationUrl !== null && typeof value.confirmationUrl !== "string") ||
        typeof value.pollAfterMs !== "number" ||
        !Number.isFinite(value.pollAfterMs) ||
        !validDate(value.accessExpiresAt)
    ) {
        throw new BillingError("invalid_response")
    }
    const grant = value.grant
    if (
        grant !== null &&
        (!record(grant) ||
            grant.applied !== true ||
            !isPaidPlanSlug(grant.planSlug) ||
            grant.planSlug !== value.plan.slug ||
            !validDate(grant.validFrom) ||
            !validDate(grant.validUntil) ||
            Date.parse(grant.validUntil) <= Date.parse(grant.validFrom) ||
            (grant.effectivePlanSlug !== "free" && !isPaidPlanSlug(grant.effectivePlanSlug)))
    )
        throw new BillingError("invalid_response")
    if (value.status === "succeeded" && !grant) throw new BillingError("activation_pending")
    return value as CheckoutOrder
}
export function confirmationUrl(value: string | null): string | null {
    if (!value) return null
    try {
        const url = new URL(value)
        return url.protocol === "https:" &&
            ["yoomoney.ru", "yookassa.ru"].includes(url.hostname) &&
            !url.username &&
            !url.password &&
            !url.port
            ? url.href
            : null
    } catch {
        return null
    }
}
export function formatAmount(plan: BillingPlan): string {
    return new Intl.NumberFormat("ru-RU", {
        style: "currency",
        currency: "RUB",
        maximumFractionDigits: Number(plan.amount.value) % 1 ? 2 : 0,
    }).format(Number(plan.amount.value))
}
async function request(path: string, options: RequestInit, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    if (signal?.aborted) abort()
    else signal?.addEventListener("abort", abort, { once: true })
    const timer = setTimeout(() => controller.abort(), 20_000)
    try {
        const response = await fetch(`${getApiBase()}/billing${path}`, {
            ...options,
            cache: "no-store",
            signal: controller.signal,
        })
        const body: unknown = await response.json().catch(() => null)
        if (!response.ok) {
            const code = record(body) && typeof body.code === "string" ? body.code :
                response.status === 401 || response.status === 403 ? "login_required" : "network_error"
            const retrySeconds = Number(response.headers.get("Retry-After"))
            throw new BillingError(
                code,
                Number.isFinite(retrySeconds) && retrySeconds > 0 ? retrySeconds * 1000 : 0
            )
        }
        return body
    } catch (error) {
        if (signal?.aborted || error instanceof BillingError) throw error
        throw new BillingError("network_error")
    } finally {
        clearTimeout(timer)
        signal?.removeEventListener("abort", abort)
    }
}
export async function fetchBillingCatalog(signal?: AbortSignal): Promise<BillingCatalog> {
    return parseCatalog(await request("/catalog", {}, signal))
}
function accountAuthorization(): string {
    const token = localStorage.getItem("token")
    if (!token) throw new BillingError("login_required")
    return `Bearer ${token}`
}

export type CheckoutAccount = { username: string; email: string }

export async function fetchCheckoutAccount(signal: AbortSignal): Promise<CheckoutAccount> {
    const value = await request("/account", { headers: { Authorization: accountAuthorization() } }, signal)
    if (!record(value) || typeof value.username !== "string" || typeof value.email !== "string")
        throw new BillingError("invalid_response")
    return { username: value.username, email: value.email }
}

export async function createCheckout(
    data: CheckoutRequest,
    signal?: AbortSignal
): Promise<CheckoutOrder> {
    return parseOrder(
        await request(
            "/orders",
            {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: accountAuthorization() },
                body: JSON.stringify(data),
            },
            signal
        )
    )
}
export async function fetchCheckout(
    orderId: string,
    token: string,
    signal?: AbortSignal
): Promise<CheckoutOrder> {
    return parseOrder(
        await request(
            `/orders/${encodeURIComponent(orderId)}`,
            { headers: { Authorization: `Bearer ${token}` } },
            signal
        )
    )
}
