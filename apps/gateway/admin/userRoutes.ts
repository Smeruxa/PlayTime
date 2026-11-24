import { json, Router } from "express"
import { pool } from "../../shared/config"
import { resolveClientIp } from "../../shared/http/clientIp"
import type { AccountBlockCommand, AccountBlockResult } from "../../shared/runtime/authContracts"
import type { FeatureIo } from "../../shared/socket/featureContext"
import { isPlanSlug } from "../../shared/subscription/planCatalog"
import type { PublishSubscriptionPlan } from "../backgroundJobs"
import {
    getLimitsForUser,
    getPlanSlugForUser,
    sanitizeStoredProfileForPlan,
    upsertUserSubscription
} from "../subscription/subscriptionService"
import { logAdminAction } from "./adminAuditLog"
import { adminProtect, parseAdminId } from "./routeGuards"

export type AccountModerator = (command: AccountBlockCommand, io?: FeatureIo) => Promise<AccountBlockResult>

export function createUserRoutes(moderateAccount: AccountModerator) {
    const router = Router()

    router.get("/users", ...adminProtect, async (req, res) => {
        try {
            const q = typeof req.query.query === "string" ? req.query.query.trim() : ""
            const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20))
            const like = `%${q.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`
            const r = await pool.query<{
                id: number
                username: string
                email: string
                created_at: Date | null
                plan_slug: string | null
                is_blocked: boolean
            }>(
                `SELECT u.id, u.username, u.email, u.created_at, u.is_blocked, s.plan_slug
             FROM users u
             LEFT JOIN user_subscriptions s ON s.user_id = u.id
             WHERE u.username ILIKE $1 OR u.email ILIKE $1
             ORDER BY u.username
             LIMIT $2`,
                [like, limit]
            )
            res.json({
                users: r.rows.map((row) => ({
                    id: row.id,
                    username: row.username,
                    email: row.email,
                    createdAt: row.created_at?.toISOString() ?? null,
                    planSlug: row.plan_slug ?? "free",
                    isBlocked: row.is_blocked === true
                }))
            })
        } catch (e) {
            console.error("admin/users", e)
            res.status(500).json({ error: "Server error" })
        }
    })

    router.get("/users/:id/subscription", ...adminProtect, async (req, res) => {
        try {
            const targetId = parseAdminId(req.params.id)
            if (targetId === null) {
                res.status(400).json({ error: "Invalid id" })
                return
            }
            const slug = await getPlanSlugForUser(targetId)
            const limits = (await getLimitsForUser(targetId)).limits
            const {
                rows: [block]
            } = await pool.query<{
                is_blocked: boolean
                blocked_at: Date | null
                blocked_reason: string | null
            }>("SELECT is_blocked, blocked_at, blocked_reason FROM users WHERE id = $1", [targetId])
            res.json({
                userId: targetId,
                planSlug: slug,
                limits,
                isBlocked: block?.is_blocked ?? false,
                blockedAt: block?.blocked_at?.toISOString() ?? null,
                blockedReason: block?.blocked_reason ?? null
            })
        } catch (e) {
            console.error("admin/users/:id/subscription get", e)
            res.status(500).json({ error: "Server error" })
        }
    })

    router.put("/users/:id/subscription", ...adminProtect, json({ limit: "16kb" }), async (req, res) => {
        try {
            const uid = null
            const targetId = parseAdminId(req.params.id)
            if (targetId === null) {
                res.status(400).json({ error: "Invalid id" })
                return
            }
            const body = req.body as { plan_slug?: unknown; note?: unknown }
            const planSlug = typeof body.plan_slug === "string" ? body.plan_slug.trim() : ""
            if (!isPlanSlug(planSlug)) {
                res.status(400).json({ error: "Invalid plan_slug" })
                return
            }
            const note = typeof body.note === "string" ? body.note.slice(0, 500) : null
            const u = await pool.query<{ is_admin: boolean }>("SELECT is_admin FROM users WHERE id = $1", [targetId])
            if (u.rows.length === 0) {
                res.status(404).json({ error: "User not found" })
                return
            }
            if (u.rows[0].is_admin) {
                res.status(400).json({ error: "Cannot change subscription for admin user" })
                return
            }
            const prevSlug = await getPlanSlugForUser(targetId)
            await upsertUserSubscription(targetId, planSlug, uid, note)
            await sanitizeStoredProfileForPlan(targetId)
            if (prevSlug !== planSlug) {
                await logAdminAction({
                    adminUserId: uid,
                    action: "subscription.change",
                    targetUserId: targetId,
                    details: { clientIp: resolveClientIp(req), from: prevSlug, to: planSlug, note: note ?? null }
                })
            }
            const slug = await getPlanSlugForUser(targetId)
            const publishPlan = req.app.get("publishSubscriptionPlan") as PublishSubscriptionPlan | undefined
            if (publishPlan) {
                publishPlan(targetId, slug)
            } else {
                const io = req.app.get("io") as FeatureIo | undefined
                io?.to(targetId.toString()).emit("subscription:planChanged", { planSlug: slug })
            }
            const limits = (await getLimitsForUser(targetId)).limits
            res.json({ userId: targetId, planSlug: slug, limits })
        } catch (e) {
            console.error("admin/users/:id/subscription put", e)
            res.status(500).json({ error: "Server error" })
        }
    })

    router.patch("/users/:id/block", ...adminProtect, json({ limit: "4kb" }), async (req, res) => {
        try {
            const targetId = parseAdminId(req.params.id)
            if (targetId === null) {
                res.status(400).json({ error: "Invalid id" })
                return
            }
            const body = req.body as { blocked?: unknown; reason?: unknown }
            if (typeof body.blocked !== "boolean") {
                res.status(400).json({ error: "blocked boolean required" })
                return
            }
            const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null
            const io = req.app.get("io") as FeatureIo | undefined
            const result = await moderateAccount(
                { userId: targetId, blocked: body.blocked, reason, clientIp: resolveClientIp(req) },
                io
            )
            if (result.kind === "missing") {
                res.status(404).json({ error: "User not found" })
                return
            }
            if (result.kind === "protected") {
                res.status(400).json({ error: "Cannot block admin user" })
                return
            }
            res.json({ userId: targetId, ...result.state })
        } catch (e) {
            console.error("admin/users/:id/block", e)
            res.status(500).json({ error: "Server error" })
        }
    })

    return router
}
