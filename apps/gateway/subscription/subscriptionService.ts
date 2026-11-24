import type { PoolClient } from "pg"
import * as subscriptionPlans from "../../database/subscriptionPlans"
import { pool } from "../../shared/deps"
import type { PlanSlug } from "../../shared/subscription/planCatalog"
import { allowedAvatarEffects, allowedBannerEffects } from "../../shared/subscription/profileCustomization"

export function getLimitsForUser(userId: number, db: Pick<PoolClient, "query"> = pool) {
    return subscriptionPlans.getLimitsForUser(userId, db)
}

export function getPlanSlugForUser(userId: number, db: Pick<PoolClient, "query"> = pool) {
    return subscriptionPlans.getPlanSlugForUser(userId, db)
}

export function getRoomPlanLimits(roomId: number) {
    return subscriptionPlans.getRoomPlanLimits(roomId, pool)
}

export async function upsertUserSubscription(
    userId: number,
    planSlug: PlanSlug,
    updatedBy: number | null,
    note: string | null
): Promise<void> {
    await pool.query(
        `INSERT INTO user_subscriptions (user_id, plan_slug, updated_by, note)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET
           plan_slug = EXCLUDED.plan_slug,
           updated_at = NOW(),
           updated_by = EXCLUDED.updated_by,
           note = EXCLUDED.note`,
        [userId, planSlug, updatedBy, note]
    )
}

export async function sanitizeStoredProfileForPlan(userId: number): Promise<void> {
    const { limits } = await getLimitsForUser(userId)
    const clearBanner = !limits.profileBannerAllowed

    await pool.query(
        `UPDATE users SET
            profile_banner = CASE WHEN $1 THEN NULL ELSE profile_banner END,
            profile_avatar_effect = CASE WHEN profile_avatar_effect = ANY($2::text[]) THEN profile_avatar_effect ELSE 'none' END,
            profile_banner_effect = CASE WHEN profile_banner_effect = ANY($3::text[]) THEN profile_banner_effect ELSE 'none' END,
            profile_banner_sticker = CASE WHEN $4 THEN 'none' ELSE profile_banner_sticker END
         WHERE id = $5`,
        [
            clearBanner,
            [...allowedAvatarEffects(limits)],
            [...allowedBannerEffects(limits)],
            !limits.profileBannerEffectsAllowed,
            userId
        ]
    )
}
