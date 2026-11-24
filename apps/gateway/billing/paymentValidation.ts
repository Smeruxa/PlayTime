import { formatAmount } from "./catalog"
import type { OrderRow } from "./types"
import { safeConfirmationUrl, UUID } from "./validation"

type VerifiedPayment = {
    id: string
    status: "pending" | "waiting_for_capture" | "succeeded" | "canceled"
    paid: boolean
    confirmationUrl: string | null
}

function object(value: unknown): Record<string, unknown> {
    return value != null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function verifiedPayment(value: unknown, order: OrderRow, creating = false): VerifiedPayment | null {
    const payment = object(value)
    const amount = object(payment.amount)
    const recipient = object(payment.recipient)
    const metadata = object(payment.metadata)
    const confirmation = object(payment.confirmation)
    const expected = order.provider_request.metadata
    if (
        typeof payment.id !== "string" ||
        !UUID.test(payment.id) ||
        (order.provider_id && payment.id !== order.provider_id) ||
        (order.mode !== "test" && order.mode !== "live") ||
        payment.test !== (order.mode === "test") ||
        recipient.account_id !== order.shop_id ||
        amount.currency !== order.currency ||
        amount.value !== formatAmount(order.amount_minor) ||
        metadata.order_id !== order.id ||
        metadata.user_id !== expected.user_id ||
        metadata.plan_slug !== order.plan_slug ||
        typeof payment.paid !== "boolean"
    )
        return null
    const status = payment.status
    if (status !== "pending" && status !== "waiting_for_capture" && status !== "succeeded" && status !== "canceled")
        return null
    if ((status === "succeeded" && !payment.paid) || (status === "canceled" && payment.paid)) return null
    const confirmationUrl = safeConfirmationUrl(confirmation.confirmation_url)
    if (
        (confirmation.confirmation_url != null && !confirmationUrl) ||
        (creating && status === "pending" && !confirmationUrl)
    )
        return null
    return { id: payment.id, status, paid: payment.paid, confirmationUrl }
}
