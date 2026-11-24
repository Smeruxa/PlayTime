import { createHmac } from "node:crypto"
import { isIP } from "node:net"
import { ipKeyGenerator } from "express-rate-limit"
import { pool, JWT_SECRET } from "../../shared/config"

export const VISIT_TTL_SECONDS = 30 * 60
export const PUBLIC_SITE_PAGES = ["landing", "terms", "privacy", "feedback"] as const

function digest(value: string): string {
    return createHmac("sha256", JWT_SECRET).update(`playtime-site-visits:v1:${value}`).digest("hex")
}

export function visitSessionHash(id: string): string {
    return digest(`session:${id}`)
}

export function visitBudgetIpHash(ip: string): string {
    if (!isIP(ip)) throw new Error("Invalid client address")
    return digest(`budget:${new Date().toISOString().slice(0, 10)}:${ipKeyGenerator(ip, 56)}`)
}

export const VISIT_BUDGET_SCRIPT = `
local global = tonumber(redis.call('GET', KEYS[1]) or '0')
if global >= 1200 then return math.max(1, redis.call('TTL', KEYS[1])) end
local count = tonumber(redis.call('GET', KEYS[2]) or '0')
if count >= 60 then return math.max(1, redis.call('TTL', KEYS[2])) end
if redis.call('INCR', KEYS[1]) == 1 then redis.call('EXPIRE', KEYS[1], 60) end
if redis.call('INCR', KEYS[2]) == 1 then redis.call('EXPIRE', KEYS[2], 60) end
return 0
`

export async function recordSiteVisit(sessionId: string): Promise<void> {
    const hash = visitSessionHash(sessionId)
    const client = await pool.connect()
    try {
        await client.query("BEGIN")
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`site-visit:${hash}`])
        const current = await client.query<{ active: boolean }>(
            "SELECT expires_at > clock_timestamp() AS active FROM site_visit_sessions WHERE session_hash=$1",
            [hash]
        )
        if (!current.rows[0]?.active) {
            await client.query(`
                INSERT INTO site_visit_days(day, visits)
                VALUES ((clock_timestamp() AT TIME ZONE 'Europe/Moscow')::date, 1)
                ON CONFLICT(day) DO UPDATE SET visits=site_visit_days.visits+1
            `)
        }
        await client.query(
            "INSERT INTO site_visit_sessions(session_hash, expires_at) VALUES ($1, clock_timestamp() + INTERVAL '30 minutes') ON CONFLICT(session_hash) DO UPDATE SET expires_at=EXCLUDED.expires_at",
            [hash]
        )
        await client.query("COMMIT")
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {})
        throw error
    } finally {
        client.release()
    }
}

export async function cleanupSiteVisitSessions(): Promise<void> {
    await pool.query("DELETE FROM site_visit_sessions WHERE expires_at <= clock_timestamp()")
}

export async function getSiteVisitStats(at: Date | null = null) {
    const result = await pool.query<{
        today: string
        week: string
        total: string
        enabled_at: Date
    }>(
        `
        WITH period AS (
            SELECT (COALESCE($1::timestamptz, NOW()) AT TIME ZONE 'Europe/Moscow')::date AS today
        )
        SELECT
            COALESCE(SUM(visits) FILTER (WHERE day=(SELECT today FROM period)), 0)::text AS today,
            COALESCE(SUM(visits) FILTER (WHERE day BETWEEN (SELECT today FROM period)-6 AND (SELECT today FROM period)), 0)::text AS week,
            COALESCE(SUM(visits), 0)::text AS total,
            (SELECT enabled_at FROM site_visit_settings WHERE id=1) AS enabled_at
        FROM site_visit_days
    `,
        [at]
    )
    const row = result.rows[0]
    return {
        today: Number(row.today),
        week: Number(row.week),
        total: Number(row.total),
        enabledAt: row.enabled_at,
        timeZone: "Europe/Moscow",
        sessionMinutes: VISIT_TTL_SECONDS / 60
    }
}
