import { logAdminAction } from "../../database/adminAudit"
import { pool } from "../../shared/config"
import type { ChatReport } from "../../shared/runtime/chatContracts"

type ReportRow = Omit<ChatReport, "created_at" | "resolved_at"> & {
    created_at: Date
    resolved_at: Date | null
}

export async function listPeerReports(beforeId: string): Promise<ChatReport[]> {
    const { rows } = await pool.query<ReportRow>(
        `SELECT r.id, reporter.username AS reporter, target.username AS reported, r.reason, r.created_at, r.resolved_at
         FROM user_reports r
         LEFT JOIN users reporter ON reporter.id = r.reporter_id
         LEFT JOIN users target ON target.id = r.reported_id
         WHERE r.id < $1 ORDER BY r.id DESC LIMIT 50`,
        [beforeId]
    )
    return rows.map((row) => ({
        ...row,
        created_at: row.created_at.toISOString(),
        resolved_at: row.resolved_at?.toISOString() ?? null
    }))
}

export async function resolvePeerReport(reportId: string): Promise<void> {
    const client = await pool.connect()
    try {
        await client.query("BEGIN")
        const changed = await client.query(
            "UPDATE user_reports SET resolved_at=NOW() WHERE id=$1 AND resolved_at IS NULL RETURNING id",
            [reportId]
        )
        if (changed.rows.length) {
            await logAdminAction({ adminUserId: null, action: "report.resolve", details: { reportId } }, client)
        }
        await client.query("COMMIT")
    } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined)
        throw error
    } finally {
        client.release()
    }
}
