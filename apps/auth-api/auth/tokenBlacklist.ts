import { pool } from "../../shared/config"

export async function isJwtBlacklisted(jti: string | undefined): Promise<boolean> {
    if (!jti || typeof jti !== "string" || jti.length > 128) return true
    const result = await pool.query("SELECT 1 FROM revoked_access_tokens WHERE jti = $1 AND expires_at > NOW()", [jti])
    return result.rows.length > 0
}

export async function blacklistAccessJti(jti: string, expUnix: number): Promise<void> {
    if (!jti || jti.length > 128 || expUnix <= Date.now() / 1000) return
    await pool.query("INSERT INTO revoked_access_tokens(jti, expires_at) VALUES ($1, TO_TIMESTAMP($2)) ON CONFLICT(jti) DO UPDATE SET expires_at = GREATEST(revoked_access_tokens.expires_at, EXCLUDED.expires_at)", [jti, expUnix])
}
