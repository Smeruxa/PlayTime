import type { PoolClient } from "pg"
import { pool } from "../../shared/config"

export async function getSessionVersion(userId: number): Promise<number> {
    const result = await pool.query<{ auth_version: string | number }>("SELECT auth_version FROM users WHERE id = $1", [
        userId
    ])
    if (!result.rows.length) throw new Error("account missing")
    const version = Number(result.rows[0].auth_version)
    if (!Number.isSafeInteger(version) || version < 0) throw new Error("invalid session version")
    return version
}

export async function revokeUserCredentials(userId: number, client?: Pick<PoolClient, "query">): Promise<void> {
    await (client ?? pool).query("UPDATE users SET auth_version = auth_version + 1 WHERE id = $1", [userId])
}

export { accessSessionRoom, deviceSessionRoom } from "../../shared/types/contracts/accessSession"
