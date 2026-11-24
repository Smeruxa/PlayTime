import type { PoolClient } from "pg"
import fs from "node:fs/promises"
import path from "node:path"
import type { RequestHandler } from "express"
import { pool } from "../../shared/config"
import { getLimitsForUser } from "../../database/subscriptionPlans"
import type { PlanLimits } from "../../shared/subscription/planCatalog"
import type { AuthedRequest } from "../../shared/http/bearerAuth"
import { consumeMediaUploadBudget, mediaReservationBytes, MediaQuotaExceeded, reserveMediaUpload } from "./mediaQuota"

export type MediaKind = "attachment" | "voice"
export const MEDIA_ENCRYPTION_OVERHEAD = 16
const STAGING_TTL_MS = 2 * 60 * 60 * 1000
const KEY_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/

declare global {
    namespace Express {
        interface Request {
            mediaUpload?: { key: string; maxBytes: number; limits: PlanLimits }
        }
    }
}

export function mediaBaseDir(kind: MediaKind): string {
    const raw = (kind === "attachment" ? process.env.ATTACHMENT_STORAGE_DIR : process.env.VOICE_STORAGE_DIR)?.trim()
    return path.resolve(raw || path.join((process.env.PLAYTIME_BACKEND_ROOT || process.cwd()), "data", kind === "attachment" ? "attachments" : "voices"))
}

export function mediaPath(kind: MediaKind, key: string, staging = false): string {
    if (!KEY_RE.test(key)) throw new Error("Invalid media key")
    return path.join(mediaBaseDir(kind), ...(staging ? ["staging"] : []), key + (kind === "voice" ? ".webm" : ""))
}

export async function removeMediaObject(kind: MediaKind, key: string, db: Pick<PoolClient, "query"> = pool): Promise<void> {
    for (const staging of [true, false]) {
        try {
            await fs.unlink(mediaPath(kind, key, staging))
        } catch (error) {
            if ((error as { code?: string }).code !== "ENOENT") throw error
        }
    }
    await db.query(
        kind === "voice"
            ? "DELETE FROM voice_staging WHERE voice_key = $1"
            : "DELETE FROM attachment_staging WHERE attachment_key = $1",
        [key]
    )
    await db.query("DELETE FROM media_objects WHERE storage_key = $1 AND kind = $2", [key, kind])
}

export function reserveUpload(kind: MediaKind, getMaxBytes: (limits: PlanLimits) => number): RequestHandler {
    return async (req, res, next) => {
        if (req.header("x-playtime-media-format") !== "secretbox-v1") {
            res.status(400).json({ error: "Обновите приложение для отправки зашифрованных файлов." })
            return
        }
        try {
            const userId = (req as AuthedRequest).userId
            await consumeMediaUploadBudget(userId)
            const { planSlug, limits } = await getLimitsForUser(userId, pool)
            const maxBytes = mediaReservationBytes(req.header("content-length"), getMaxBytes(limits))
            const key = await reserveMediaUpload(userId, kind, maxBytes, planSlug)
            req.mediaUpload = { key, maxBytes, limits }
            let finished = false
            const release = () => {
                if (finished) return
                finished = true
                void removeMediaObject(kind, key).catch((error) => console.error("media upload cleanup", error))
            }
            req.on("aborted", release)
            res.on("finish", () => {
                if (res.statusCode >= 400) release()
            })
            next()
        } catch (error) {
            if (!(error instanceof MediaQuotaExceeded)) console.error("media reservation", error)
            res.status(429).json({ error: "Лимит хранилища исчерпан или загрузка временно недоступна." })
        }
    }
}

export async function finishMediaUpload(key: string, bytes: number): Promise<void> {
    const result = await pool.query(
        "UPDATE media_objects SET size_bytes = $2 WHERE storage_key = $1 AND finalized_at IS NULL AND size_bytes >= $2 RETURNING storage_key",
        [key, bytes]
    )
    if (!result.rowCount) throw new Error("Media reservation expired")
}

export async function finalizeMediaObject(key: string, db: Pick<PoolClient, "query"> = pool): Promise<void> {
    await db.query("UPDATE media_objects SET finalized_at = NOW() WHERE storage_key = $1", [key])
}

export async function cleanupMediaStorage(db: Pick<PoolClient, "query"> = pool): Promise<void> {
    const expired = await db.query<{ storage_key: string; kind: MediaKind }>(
        `SELECT storage_key, kind FROM media_objects o WHERE
          NOT EXISTS (SELECT 1 FROM users u WHERE u.id = o.user_id) OR
          (finalized_at IS NULL AND created_at < NOW() - INTERVAL '2 hours') OR
          (finalized_at IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM messages m WHERE m.attachment_storage_key = o.storage_key OR m.voice_storage_key = o.storage_key
          ))`
    )
    for (const object of expired.rows) {
        try {
            await removeMediaObject(object.kind, object.storage_key, db)
        } catch (error) {
            console.error("media cleanup", error)
        }
    }
    await db.query("DELETE FROM attachment_staging WHERE created_at < NOW() - INTERVAL '2 hours'")
    await db.query("DELETE FROM voice_staging WHERE created_at < NOW() - INTERVAL '2 hours'")
    const legacy = await db.query<{ storage_key: string; kind: MediaKind; finalized_at: Date | null }>(
        "SELECT storage_key, kind, finalized_at FROM media_objects WHERE encrypted = FALSE"
    )
    for (const object of legacy.rows) {
        try {
            const stat = await fs.stat(mediaPath(object.kind, object.storage_key, !object.finalized_at))
            await db.query("UPDATE media_objects SET size_bytes = $2 WHERE storage_key = $1", [
                object.storage_key,
                stat.size
            ])
        } catch (error) {
            if ((error as { code?: string }).code !== "ENOENT") throw error
        }
    }
    const tracked = await db.query<{ storage_key: string }>("SELECT storage_key FROM media_objects")
    const keys = new Set(tracked.rows.map((row) => row.storage_key))
    for (const kind of ["voice", "attachment"] as const) {
        for (const staging of [true, false]) {
            const directory = path.join(mediaBaseDir(kind), ...(staging ? ["staging"] : []))
            let entries: import("node:fs").Dirent[]
            try {
                entries = await fs.readdir(directory, { withFileTypes: true })
            } catch (error) {
                if ((error as { code?: string }).code === "ENOENT") continue
                throw error
            }
            for (const entry of entries) {
                if (!entry.isFile()) continue
                const key = kind === "voice" ? entry.name.replace(/\.webm$/, "") : entry.name
                if (!KEY_RE.test(key) || keys.has(key)) continue
                const file = path.join(directory, entry.name)
                try {
                    const stat = await fs.stat(file)
                    if (stat.mtimeMs < Date.now() - STAGING_TTL_MS) await fs.unlink(file)
                } catch (error) {
                    if ((error as { code?: string }).code !== "ENOENT") throw error
                }
            }
        }
    }
}
