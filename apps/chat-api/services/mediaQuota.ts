import { randomUUID } from "node:crypto"
import { pool, redis } from "../../shared/config"
import type { PlanSlug } from "../../shared/subscription/planCatalog"
import type { MediaKind } from "./mediaStorage"

const RESERVATION_LOCK = 1919247471
const MIB = 1024 ** 2
const UPLOADS_PER_MINUTE = 30

const consumeUpload = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], 60) end
return count`

type QuotaGroup = "guest" | "free" | "paid"

export class MediaQuotaExceeded extends Error {}

function bytesLimit(name: string, fallback: number): number {
    const value = Number(process.env[name])
    return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function quotaLimits(group: QuotaGroup) {
    const total = bytesLimit("MEDIA_STORAGE_MAX_BYTES", 2048 * MIB)
    const user = bytesLimit("MEDIA_USER_MAX_BYTES", 256 * MIB)
    if (group === "guest") {
        return { total, group: Math.floor(total / 16), user: Math.min(user, 8 * MIB) }
    }
    if (group === "free") {
        return { total, group: Math.floor(total / 4), user: Math.min(user, 32 * MIB) }
    }
    return { total, group: total, user }
}

export async function consumeMediaUploadBudget(userId: number): Promise<void> {
    const count = await redis.eval(consumeUpload, 1, `media:upload:${userId}`)
    if (typeof count !== "number" || count > UPLOADS_PER_MINUTE) throw new MediaQuotaExceeded()
}

export function mediaReservationBytes(contentLength: string | undefined, maxBytes: number): number {
    if (contentLength === undefined || !/^\d+$/.test(contentLength)) return maxBytes
    return Math.min(Number(contentLength), maxBytes)
}

export function voiceReservationLimit(durationSeconds: number): number {
    return Math.min(6 * MIB, durationSeconds * 32 * 1024 + 64 * 1024)
}

export async function reserveMediaUpload(
    userId: number,
    kind: MediaKind,
    maxBytes: number,
    plan: PlanSlug
): Promise<string> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new MediaQuotaExceeded()
    const client = await pool.connect()
    try {
        await client.query("BEGIN")
        await client.query("SELECT pg_advisory_xact_lock($1)", [RESERVATION_LOCK])
        const {
            rows: [usage]
        } = await client.query<{
            quota_group: QuotaGroup
            total_size: string
            group_size: string
            owner_size: string
            attachments: number
            voices: number
        }>(
            `SELECT tier.quota_group, global.size_bytes AS total_size, category.size_bytes AS group_size,
                    COALESCE(owner.size_bytes, 0) AS owner_size,
                    COALESCE(owner.attachments, 0) AS attachments, COALESCE(owner.voices, 0) AS voices
             FROM users u
             CROSS JOIN LATERAL (SELECT CASE WHEN u.is_guest THEN 'guest' ELSE $2 END AS quota_group) tier
             JOIN media_quota_usage global ON global.scope = 'all' AND global.user_id = 0
             JOIN media_quota_usage category ON category.scope = tier.quota_group AND category.user_id = 0
             LEFT JOIN media_quota_usage owner ON owner.scope = 'user' AND owner.user_id = u.id
             WHERE u.id = $1`,
            [userId, plan === "free" ? "free" : "paid"]
        )
        if (!usage) throw new MediaQuotaExceeded()
        const limits = quotaLimits(usage.quota_group)
        if (
            Number(usage.total_size) + maxBytes > limits.total ||
            Number(usage.group_size) + maxBytes > limits.group ||
            Number(usage.owner_size) + maxBytes > limits.user ||
            (kind === "attachment" ? usage.attachments >= 500 : usage.voices >= 200)
        ) {
            throw new MediaQuotaExceeded()
        }
        const key = randomUUID()
        await client.query(
            "INSERT INTO media_objects(storage_key, user_id, kind, size_bytes, encrypted, quota_group) VALUES ($1, $2, $3, $4, TRUE, $5)",
            [key, userId, kind, maxBytes, usage.quota_group]
        )
        await client.query("COMMIT")
        return key
    } catch (error) {
        await client.query("ROLLBACK")
        throw error
    } finally {
        client.release()
    }
}
