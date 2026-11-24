import { pool } from "../../shared/config"

export { logAdminAction } from "../../database/adminAudit"

export type AdminAuditRow = {
    id: number
    admin_user_id: number | null
    admin_username: string | null
    action: string
    target_user_id: number | null
    target_username: string | null
    details: Record<string, unknown>
    created_at: Date
}

export async function listAdminAuditLog(limit: number, offset: number): Promise<AdminAuditRow[]> {
    const r = await pool.query<{
        id: number
        admin_user_id: number | null
        admin_username: string | null
        action: string
        target_user_id: number | null
        target_username: string | null
        details: Record<string, unknown>
        created_at: Date
    }>(
        `SELECT l.id, l.admin_user_id, au.username AS admin_username,
                l.action, l.target_user_id, tu.username AS target_username,
                l.details, l.created_at
         FROM admin_audit_log l
         LEFT JOIN users au ON au.id = l.admin_user_id
         LEFT JOIN users tu ON tu.id = l.target_user_id
         ORDER BY l.created_at DESC, l.id DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
    )
    return r.rows
}

export function auditRowToDto(row: AdminAuditRow) {
    return {
        id: row.id,
        action: row.action,
        adminUserId: row.admin_user_id,
        adminUsername: row.admin_username,
        targetUserId: row.target_user_id,
        targetUsername: row.target_username,
        details: row.details ?? {},
        createdAt: row.created_at.toISOString()
    }
}
