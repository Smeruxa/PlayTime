import type { FeatureContext } from "../../../shared/socket/featureContext"
import { pool } from "../../../shared/deps"
import type { RowFriendAvatarPlanRow } from "../../../shared/types/db"
import { socketAck } from "../../../shared/types/socket/ack"
import { getPlanLimits, isPlanSlug } from "../../../shared/subscription/planCatalog"
import { visibleAvatarEffect } from "../../../shared/subscription/profileCustomization"
import { effectivePaidPlans } from "../../../database/subscriptionPlans"
import type { FriendsAvatarsAck, FriendsAvatarsPayload } from "./contracts"

export async function areFriends(userIdA: number, userIdB: number): Promise<boolean> {
    const r = await pool.query(
        "SELECT 1 FROM friendships WHERE ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND status='accepted'",
        [userIdA, userIdB]
    )
    return r.rows.length > 0
}

export async function acceptedContactIds(userId: number): Promise<number[]> {
    const { rows } = await pool.query<{ id: number }>(
        `SELECT CASE WHEN user_id = $1 THEN friend_id ELSE user_id END AS id
         FROM friendships WHERE (user_id = $1 OR friend_id = $1) AND status = 'accepted'`,
        [userId]
    )
    return rows.map((row) => row.id)
}

export function registerFriendAvatars({ socket, user }: FeatureContext): void {
    const uid = user.id

    socket.on("profile:friendsAvatars", async (data: FriendsAvatarsPayload, callback: unknown) => {
        const byUserId = data?.byUserId === true
        const cb = socketAck<FriendsAvatarsAck>(callback)
        if (!cb) return
        try {
            const r = await pool.query<RowFriendAvatarPlanRow>(
                `SELECT u.id, u.username, u.profile_avatar, u.profile_avatar_effect,
                        COALESCE(s.plan_slug, 'free') AS plan_slug
                 FROM friendships f
                 JOIN users u ON u.id = CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
                 LEFT JOIN user_subscriptions s ON s.user_id = u.id
                 WHERE (f.user_id = $1 OR f.friend_id = $1)
                   AND f.status = 'accepted'
                   AND f.user_id != f.friend_id
                   AND ($2::boolean OR (u.guest_archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM username_reclaims nr WHERE nr.username = u.username)))`,
                [uid, byUserId]
            )
            const me = await pool.query<RowFriendAvatarPlanRow>(
                `SELECT u.id, u.username, u.profile_avatar, u.profile_avatar_effect,
                        COALESCE(s.plan_slug, 'free') AS plan_slug
                 FROM users u
                 LEFT JOIN user_subscriptions s ON s.user_id = u.id
                 WHERE u.id = $1`,
                [uid]
            )
            const records = [...r.rows, ...me.rows]
            const plans = await effectivePaidPlans(
                records.map((row) => ({
                    id: row.id,
                    manual: row.plan_slug && isPlanSlug(row.plan_slug) ? row.plan_slug : "free"
                })),
                pool
            )
            const out: FriendsAvatarsAck = {}
            for (const row of records) {
                const slug = plans.get(row.id) ?? "free"
                const lim = getPlanLimits(slug)
                out[byUserId ? String(row.id) : row.username] = {
                    avatar: row.profile_avatar ?? null,
                    profileAvatarEffect: visibleAvatarEffect(lim, row.profile_avatar_effect)
                }
            }
            cb(out)
        } catch (e) {
            console.error("profile:friendsAvatars", e)
            cb({})
        }
    })
}
