import crypto from "node:crypto"
import { cleanupExpiredGuests } from "./guestLifecycle"
import { pool, redis } from "../../shared/config"

export async function migrateLegacySessions(): Promise<void> {
    const client = await pool.connect()
    try {
        await client.query("BEGIN")
        await client.query("SELECT pg_advisory_xact_lock(1919247472)")
        if ((await client.query("SELECT 1 FROM auth_migration_state WHERE name = 'redis-v1'")).rows.length) {
            await client.query("COMMIT")
            return
        }
        const users = (await client.query<{ id: number }>("SELECT id FROM users")).rows
        const ids = new Set(users.map((row) => row.id))
        for (const { id } of users) {
            const raw = await redis.get(`auth:session-version:${id}`)
            const version = Number(raw || 0)
            if (Number.isSafeInteger(version) && version >= 0)
                await client.query("UPDATE users SET auth_version = GREATEST(auth_version, $2) WHERE id = $1", [
                    id,
                    version
                ])
        }
        for (const prefix of ["rt:", "jwt:bl:"]) {
            let cursor = "0"
            do {
                const result = await redis.scan(cursor, "MATCH", prefix + "*", "COUNT", 100)
                cursor = result[0]
                for (const key of result[1]) {
                    const ttl = await redis.ttl(key)
                    if (ttl <= 0) continue
                    if (prefix === "jwt:bl:") {
                        const jti = key.slice(prefix.length)
                        if (jti.length <= 128)
                            await client.query(
                                "INSERT INTO revoked_access_tokens(jti, expires_at) VALUES ($1, NOW() + $2 * INTERVAL '1 second') ON CONFLICT DO NOTHING",
                                [jti, ttl]
                            )
                        continue
                    }
                    const rawToken = key.slice(prefix.length)
                    if (!/^[a-f0-9]{64}$/.test(rawToken)) continue
                    const value = await redis.get(key)
                    let user: { id: number; sessionVersion?: number }
                    try {
                        user = JSON.parse(value || "null")
                    } catch {
                        continue
                    }
                    if (!user || !ids.has(user.id)) continue
                    await client.query(
                        `INSERT INTO auth_sessions(id, user_id, refresh_token_hash, session_version, expires_at, device_name)
                        SELECT $1, id, $3, $4, NOW() + $5 * INTERVAL '1 second', 'Существующее устройство' FROM users WHERE id = $2 AND auth_version = $4
                        ON CONFLICT DO NOTHING`,
                        [
                            crypto.randomUUID(),
                            user.id,
                            crypto.createHash("sha256").update(rawToken).digest("hex"),
                            user.sessionVersion ?? 0,
                            ttl
                        ]
                    )
                }
            } while (cursor !== "0")
        }
        await client.query("INSERT INTO auth_migration_state(name) VALUES ('redis-v1')")
        await client.query("COMMIT")
    } catch (error) {
        await client.query("ROLLBACK")
        throw error
    } finally {
        client.release()
    }
}

export async function cleanupExpiredSessions(): Promise<void> {
    await cleanupExpiredGuests()
    await pool.query("DELETE FROM auth_refresh_receipts WHERE expires_at < NOW()")
    await pool.query("DELETE FROM auth_guest_receipts WHERE expires_at < NOW()")
    await pool.query("DELETE FROM revoked_access_tokens WHERE expires_at < NOW()")
    await pool.query(`DELETE FROM auth_sessions s WHERE (expires_at < NOW() - INTERVAL '7 days' OR revoked_at < NOW() - INTERVAL '7 days')
        AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id=s.user_id AND u.is_guest=TRUE AND u.guest_registration_pending=FALSE AND u.guest_archived_at IS NULL)`)
}
