import type { PoolClient } from "pg"
import { pool } from "../shared/config"

type AdminAuditAction =
    | "subscription.change"
    | "user.block"
    | "user.unblock"
    | "release.publish"
    | "release.unpublish"
    | "release.latest"
    | "release.notes"
    | "report.resolve"
    | "ticket.update"

export async function logAdminAction(
    {
        adminUserId,
        action,
        targetUserId,
        details
    }: {
        adminUserId: number | null
        action: AdminAuditAction
        targetUserId?: number | null
        details?: Record<string, unknown>
    },
    db: Pick<PoolClient, "query"> = pool
): Promise<void> {
    await db.query(
        `INSERT INTO admin_audit_log (admin_user_id, action, target_user_id, details)
         VALUES ($1, $2, $3, $4)`,
        [adminUserId, action, targetUserId ?? null, JSON.stringify(details ?? {})]
    )
}
