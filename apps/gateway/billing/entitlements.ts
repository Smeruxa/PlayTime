import type { PoolClient } from "pg"
import type { OrderRow, PaidPlanSlug } from "./types"

type Database = Pick<PoolClient, "query">
export type EntitlementRow = { plan_slug: PaidPlanSlug; valid_from: Date; valid_until: Date }

export function addCalendarMonth(date: Date): Date {
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth() + 1
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    return new Date(
        Date.UTC(
            year,
            month,
            Math.min(date.getUTCDate(), lastDay),
            date.getUTCHours(),
            date.getUTCMinutes(),
            date.getUTCSeconds(),
            date.getUTCMilliseconds()
        )
    )
}

export async function grantEntitlement(db: Database, order: OrderRow, now: Date): Promise<boolean> {
    if (order.user_id == null) return false
    const account = await db.query<{ id: number }>(
        "SELECT id FROM users WHERE id=$1 AND NOT is_blocked AND NOT is_guest AND NOT guest_registration_pending FOR UPDATE",
        [order.user_id]
    )
    if (!account.rows.length) return false
    const existing = await db.query<{ valid_until: Date | null }>(
        "SELECT MAX(valid_until) AS valid_until FROM billing_entitlements WHERE user_id=$1 AND mode=$2 AND shop_id=$3 AND plan_slug=$4 AND valid_until>$5",
        [order.user_id, order.mode, order.shop_id, order.plan_slug, now]
    )
    const from = existing.rows[0]?.valid_until ?? now
    await db.query(
        `INSERT INTO billing_entitlements(order_id,user_id,mode,shop_id,plan_slug,valid_from,valid_until)
         VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(order_id) DO NOTHING`,
        [order.id, order.user_id, order.mode, order.shop_id, order.plan_slug, from, addCalendarMonth(from)]
    )
    return true
}
