import { randomUUID } from "node:crypto"
import type { Pool } from "pg"
import { effectivePaidPlan, getManualPlanForUser } from "../../database/subscriptionPlans"
import { amountMinor, billingPlan, formatAmount } from "./catalog"
import { grantEntitlement, type EntitlementRow } from "./entitlements"
import { verifiedPayment } from "./paymentValidation"
import {
    CheckoutError,
    type BillingConfig,
    type CheckoutInput,
    type CheckoutOrder,
    type OrderRow,
    type PaymentProvider,
    type PaymentRequest
} from "./types"
import { capabilityMatches, checkoutFingerprint, digest } from "./validation"

type Dependencies = {
    pool: Pool
    config: () => BillingConfig | null
    provider: (config: BillingConfig) => PaymentProvider
    now?: () => Date
    onGrant?: (userId: number) => Promise<void> | void
}
const HOUR = 60 * 60 * 1000
const terminal = (row: OrderRow) => ["succeeded", "canceled", "review"].includes(row.state)
export class BillingService {
    private readonly now: () => Date
    constructor(private readonly dependencies: Dependencies) {
        this.now = dependencies.now ?? (() => new Date())
    }

    async account(userId: number): Promise<{ username: string; email: string }> {
        const result = await this.dependencies.pool.query<{ username: string; email: string }>(
            `SELECT username,email FROM users WHERE id=$1 AND email_verified_at IS NOT NULL
             AND NOT is_blocked AND NOT is_guest AND NOT guest_registration_pending`,
            [userId]
        )
        if (!result.rows[0]) throw new CheckoutError(403, "account_ineligible", "Для оплаты нужен аккаунт с подтверждённой почтой.")
        return result.rows[0]
    }

    async create(input: CheckoutInput & { userId: number }, ipHash: string): Promise<CheckoutOrder> {
        const config = this.dependencies.config()
        if (!config) throw new CheckoutError(503, "billing_unavailable", "Оплата временно недоступна.")
        const db = await this.dependencies.pool.connect()
        let order: OrderRow
        try {
            await db.query("BEGIN")
            await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
                `billing:request:${input.requestId}`
            ])
            const found = await db.query<OrderRow>("SELECT * FROM billing_orders WHERE request_id=$1 FOR UPDATE", [
                input.requestId
            ])
            if (found.rows.length) {
                order = found.rows[0]
                if (
                    order.user_id !== input.userId ||
                    !capabilityMatches(input.statusToken, order.capability_hash) ||
                    order.request_hash !== checkoutFingerprint(input) ||
                    order.mode !== config.mode ||
                    order.shop_id !== config.shopId
                )
                    throw new CheckoutError(
                        409,
                        "checkout_conflict",
                        "Данные заказа изменились. Вернитесь к исходному заказу."
                    )
            } else {
                const users = await db.query<{ id: number; username: string }>(
                    `SELECT id,username FROM users WHERE id=$3 AND username=$1 AND LOWER(email)=$2
                     AND email_verified_at IS NOT NULL AND NOT is_blocked AND NOT is_guest AND NOT guest_registration_pending FOR SHARE`,
                    [input.username, input.email, input.userId]
                )
                if (!users.rows.length)
                    throw new CheckoutError(
                        404,
                        "account_not_found",
                        "Не удалось найти доступный аккаунт с такими данными."
                    )
                await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`billing:ip:${ipHash}`])
                const recent = await db.query<{ count: number }>(
                    "SELECT COUNT(*)::int AS count FROM billing_orders WHERE request_ip_hash=$1 AND created_at>$2",
                    [ipHash, new Date(this.now().getTime() - HOUR)]
                )
                if (recent.rows[0].count >= 20)
                    throw new CheckoutError(429, "rate_limited", "Слишком много новых заказов. Попробуйте позже.")
                const id = randomUUID()
                const account = users.rows[0]
                const now = this.now()
                const returnUrl = new URL(config.returnUrl)
                returnUrl.searchParams.set("order", id)
                const request: PaymentRequest = {
                    amount: billingPlan(input.planSlug).amount,
                    capture: true,
                    confirmation: { type: "redirect", return_url: returnUrl.href },
                    description: `PlayTime ${billingPlan(input.planSlug).displayName}: 1 месяц`,
                    metadata: { order_id: id, user_id: String(account.id), plan_slug: input.planSlug }
                }
                const inserted = await db.query<OrderRow>(
                    `INSERT INTO billing_orders(id,request_id,capability_hash,request_hash,request_ip_hash,user_id,username_snapshot,mode,shop_id,plan_slug,amount_minor,currency,provider_request,created_at,access_expires_at,create_deadline,next_check_at)
                     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'RUB',$12,$13,$14,$15,$13) RETURNING *`,
                    [
                        id,
                        input.requestId,
                        digest(input.statusToken),
                        checkoutFingerprint(input),
                        ipHash,
                        account.id,
                        account.username,
                        config.mode,
                        config.shopId,
                        input.planSlug,
                        amountMinor(input.planSlug),
                        JSON.stringify(request),
                        now,
                        new Date(now.getTime() + 7 * 24 * HOUR),
                        new Date(now.getTime() + 23 * HOUR)
                    ]
                )
                order = inserted.rows[0]
            }
            await db.query("COMMIT")
        } catch (error) {
            await db.query("ROLLBACK")
            throw error
        } finally {
            db.release()
        }
        if (!terminal(order)) await this.reconcile(order.id)
        return this.dto(await this.load(order.id))
    }

    async status(orderId: string, token: string): Promise<CheckoutOrder> {
        const found = await this.dependencies.pool.query<OrderRow>("SELECT * FROM billing_orders WHERE id=$1", [
            orderId
        ])
        const row = found.rows[0]
        const authorized = capabilityMatches(token, row?.capability_hash)
        if (!row || !authorized) throw new CheckoutError(404, "order_not_found", "Заказ недоступен.")
        if (row.access_expires_at > this.now() && !terminal(row)) await this.reconcile(row.id)
        return this.dto(await this.load(row.id))
    }

    async tick(limit = 10): Promise<void> {
        const config = this.dependencies.config()
        if (!config) return
        const due = await this.dependencies.pool.query<{ id: string }>(
            `SELECT id FROM billing_orders WHERE mode=$1 AND shop_id=$2 AND state IN ('creating','pending')
             AND next_check_at<=$3 AND (lease_until IS NULL OR lease_until<=$3) ORDER BY next_check_at LIMIT $4`,
            [config.mode, config.shopId, this.now(), limit]
        )
        for (const row of due.rows) await this.reconcile(row.id)
    }

    async reconcile(orderId: string): Promise<void> {
        const config = this.dependencies.config()
        if (!config) return
        const now = this.now()
        const lease = randomUUID()
        const claimed = await this.dependencies.pool.query<OrderRow>(
            `UPDATE billing_orders SET lease_token=$2,lease_until=$3,attempts=attempts+1
             WHERE id=$1 AND mode=$4 AND shop_id=$5 AND state IN ('creating','pending') AND next_check_at<=$6
             AND (lease_until IS NULL OR lease_until<=$6) RETURNING *`,
            [orderId, lease, new Date(now.getTime() + 30000), config.mode, config.shopId, now]
        )
        const order = claimed.rows[0]
        if (!order) return
        if (!order.provider_id && order.create_deadline <= now) {
            await this.finish(order, lease, "review", "creation_window_elapsed")
            return
        }
        try {
            const provider = this.dependencies.provider(config)
            if (!order.provider_id) {
                const payment = verifiedPayment(await provider.create(order.provider_request, order.id), order, true)
                if (!payment) {
                    await this.finish(order, lease, "review", "verification_failed")
                    return
                }
                await this.dependencies.pool.query(
                    `UPDATE billing_orders SET provider_id=$3,confirmation_url=$4,state='pending',lease_token=NULL,lease_until=NULL,next_check_at=$5,last_error_code=NULL WHERE id=$1 AND lease_token=$2`,
                    [order.id, lease, payment.id, payment.confirmationUrl, this.now()]
                )
                return
            }
            const payment = verifiedPayment(await provider.get(order.provider_id), order)
            if (!payment) {
                await this.finish(order, lease, "review", "verification_failed")
                return
            }
            if (payment.status === "canceled") {
                await this.finish(order, lease, "canceled", null)
                return
            }
            if (payment.status !== "succeeded" || !payment.paid) {
                await this.finish(order, lease, "pending", null, 3000)
                return
            }
            await this.fulfill(order, lease)
        } catch {
            const delay = Math.min(300000, 3000 * 2 ** Math.min(7, order.attempts - 1))
            await this.finish(order, lease, order.provider_id ? "pending" : "creating", "provider_unavailable", delay)
        }
    }

    private async fulfill(order: OrderRow, lease: string): Promise<void> {
        const db = await this.dependencies.pool.connect()
        let granted = false
        try {
            await db.query("BEGIN")
            const current = (
                await db.query<OrderRow>("SELECT * FROM billing_orders WHERE id=$1 FOR UPDATE", [order.id])
            ).rows[0]
            if (current?.lease_token === lease && !terminal(current)) {
                granted = await grantEntitlement(db, current, this.now())
                await db.query(
                    "UPDATE billing_orders SET state=$2,confirmation_url=NULL,lease_token=NULL,lease_until=NULL,last_error_code=$3 WHERE id=$1",
                    [order.id, granted ? "succeeded" : "review", granted ? null : "account_unavailable"]
                )
            }
            await db.query("COMMIT")
        } catch (error) {
            await db.query("ROLLBACK")
            throw error
        } finally {
            db.release()
        }
        if (granted && order.user_id != null) {
            try {
                await this.dependencies.onGrant?.(order.user_id)
            } catch {}
        }
    }

    private async finish(
        order: OrderRow,
        lease: string,
        state: OrderRow["state"],
        code: string | null,
        delay = 0
    ): Promise<void> {
        await this.dependencies.pool.query(
            `UPDATE billing_orders SET state=$3::varchar,last_error_code=$4,lease_token=NULL,lease_until=NULL,next_check_at=$5,
             confirmation_url=CASE WHEN $3::varchar IN ('canceled','review') THEN NULL ELSE confirmation_url END WHERE id=$1 AND lease_token=$2`,
            [order.id, lease, state, code, new Date(this.now().getTime() + delay)]
        )
    }

    private async load(id: string): Promise<OrderRow> {
        return (await this.dependencies.pool.query<OrderRow>("SELECT * FROM billing_orders WHERE id=$1", [id])).rows[0]
    }

    private async dto(order: OrderRow): Promise<CheckoutOrder> {
        const expired = order.access_expires_at <= this.now()
        const entitlement = (
            await this.dependencies.pool.query<EntitlementRow>(
                "SELECT plan_slug,valid_from,valid_until FROM billing_entitlements WHERE order_id=$1",
                [order.id]
            )
        ).rows[0]
        let effective = "free"
        if (order.user_id != null) {
            const manual = await getManualPlanForUser(order.user_id, this.dependencies.pool)
            effective = await effectivePaidPlan(
                order.user_id,
                manual,
                this.dependencies.pool,
                this.dependencies.config(),
                this.now()
            )
        }
        return {
            orderId: order.id,
            mode: order.mode,
            status: expired ? "expired" : order.state === "succeeded" && !entitlement ? "review" : order.state,
            plan: {
                ...billingPlan(order.plan_slug),
                amount: { value: formatAmount(order.amount_minor), currency: order.currency }
            },
            account: { username: order.username_snapshot },
            confirmationUrl: !expired && order.state === "pending" ? order.confirmation_url : null,
            pollAfterMs: Math.max(3000, Math.min(15000, order.next_check_at.getTime() - this.now().getTime())),
            accessExpiresAt: order.access_expires_at.toISOString(),
            grant:
                !expired && entitlement
                    ? {
                          applied: true,
                          planSlug: entitlement.plan_slug,
                          validFrom: entitlement.valid_from.toISOString(),
                          validUntil: entitlement.valid_until.toISOString(),
                          effectivePlanSlug: effective
                      }
                    : null
        }
    }
}
