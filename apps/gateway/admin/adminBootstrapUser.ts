import { pool } from "../../shared/config"

export type AdminBootstrapUser = { id: number; username: string }

export async function resolveAdminBootstrapUser(): Promise<AdminBootstrapUser | null> {
    const raw = process.env.ADMIN_BOOTSTRAP_USER_ID?.trim()
    if (raw) {
        const id = parseInt(raw, 10)
        if (Number.isFinite(id) && id > 0) {
            const r = await pool.query<{ id: number; username: string; is_admin: boolean }>(
                "SELECT id, username, is_admin FROM users WHERE id = $1",
                [id]
            )
            const row = r.rows[0]
            if (row?.is_admin === true) return { id: row.id, username: row.username }
            return null
        }
    }

    const r = await pool.query<{ id: number; username: string }>(
        "SELECT id, username FROM users WHERE is_admin = TRUE ORDER BY id ASC LIMIT 1"
    )
    const row = r.rows[0]
    return row ? { id: row.id, username: row.username } : null
}
