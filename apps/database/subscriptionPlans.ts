import type { PoolClient } from "pg"
import { readBillingScope, type BillingScope } from "../shared/subscription/billingScope"
import { getPlanLimits, isPlanSlug, type PlanLimits, type PlanSlug } from "../shared/subscription/planCatalog"

type Database = Pick<PoolClient, "query">

type SubscriptionLimits = { planSlug: PlanSlug; limits: PlanLimits }

function planRank(slug: PlanSlug): number {
    return slug === "enterprise" ? 3 : slug === "pro" ? 2 : slug === "medium" ? 1 : 0
}

export async function effectivePaidPlans(
    accounts: ReadonlyArray<{ id: number; manual: PlanSlug }>,
    db: Database,
    scope: BillingScope | null = readBillingScope(),
    now = new Date()
): Promise<Map<number, PlanSlug>> {
    const plans = new Map(accounts.map((account) => [account.id, account.manual]))
    if (!scope || plans.size === 0) return plans
    const paid = await db.query<{ user_id: number; plan_slug: string }>(
        `SELECT user_id,plan_slug FROM billing_entitlements
         WHERE user_id=ANY($1::int[]) AND mode=$2 AND shop_id=$3 AND valid_from<=$4 AND valid_until>$4`,
        [[...plans.keys()], scope.mode, scope.shopId, now]
    )
    for (const row of paid.rows) {
        const plan = plans.get(row.user_id)
        if (plan && isPlanSlug(row.plan_slug) && planRank(row.plan_slug) > planRank(plan)) {
            plans.set(row.user_id, row.plan_slug)
        }
    }
    return plans
}

export async function effectivePaidPlan(
    userId: number,
    manual: PlanSlug,
    db: Database,
    scope: BillingScope | null = readBillingScope(),
    now = new Date()
): Promise<PlanSlug> {
    return (await effectivePaidPlans([{ id: userId, manual }], db, scope, now)).get(userId) ?? manual
}

export async function getManualPlanForUser(userId: number, db: Database): Promise<PlanSlug> {
    const { rows } = await db.query<{ plan_slug: string }>(
        "SELECT plan_slug FROM user_subscriptions WHERE user_id = $1",
        [userId]
    )
    const slug = rows[0]?.plan_slug
    return slug && isPlanSlug(slug) ? slug : "free"
}

export async function getPlanSlugForUser(userId: number, db: Database): Promise<PlanSlug> {
    const manual = await getManualPlanForUser(userId, db)
    return effectivePaidPlan(userId, manual, db)
}

export async function getLimitsForUser(userId: number, db: Database): Promise<SubscriptionLimits> {
    const planSlug = await getPlanSlugForUser(userId, db)
    return { planSlug, limits: getPlanLimits(planSlug) }
}

export async function getRoomPlanLimits(roomId: number, db: Database): Promise<SubscriptionLimits | null> {
    const { rows } = await db.query<{ created_by: number | null }>("SELECT created_by FROM rooms WHERE id = $1", [
        roomId
    ])
    const ownerId = rows[0]?.created_by
    return ownerId == null ? null : getLimitsForUser(ownerId, db)
}
