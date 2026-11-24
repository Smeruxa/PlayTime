import { json, Router } from "express"
import { pool } from "../../shared/config"
import { isSafeFilename } from "../../shared/files/safeFilename"
import { resolveClientIp } from "../../shared/http/clientIp"
import { releaseRegisterSecretMiddleware, releaseRegistrationLimiter } from "../middlewares/releaseRegisterSecretMiddleware"
import {
    listReleases,
    patchRelease,
    parseReleasePlatform,
    registerRelease,
    releaseRowToAdminDto
} from "../releases/releaseService"
import { logAdminAction } from "./adminAuditLog"
import { adminProtect, parseAdminId } from "./routeGuards"

const router = Router()

router.post("/releases/register", releaseRegistrationLimiter, releaseRegisterSecretMiddleware, json({ limit: "16kb" }), async (req, res) => {
    try {
        const body = req.body as {
            version?: unknown
            platform?: unknown
            filename?: unknown
            updateFilename?: unknown
            fileSize?: unknown
            updateFileSize?: unknown
            sha512?: unknown
            updateSha512?: unknown
            releaseNotes?: unknown
            publishLatest?: unknown
        }
        const version = typeof body.version === "string" ? body.version.trim() : ""
        const platform = parseReleasePlatform(typeof body.platform === "string" ? body.platform : "")
        const filename = typeof body.filename === "string" ? body.filename.trim() : ""
        const sha512 = typeof body.sha512 === "string" ? body.sha512.trim() : ""
        if (!version || !platform || !filename || !sha512) {
            res.status(400).json({ error: "Invalid payload" })
            return
        }
        const fileSize = Number(body.fileSize)
        if (!Number.isFinite(fileSize) || fileSize <= 0) {
            res.status(400).json({ error: "Invalid fileSize" })
            return
        }
        const updateFilename =
            typeof body.updateFilename === "string" && body.updateFilename.trim() ? body.updateFilename.trim() : null
        if (!isSafeFilename(filename) || (updateFilename && !isSafeFilename(updateFilename))) {
            res.status(400).json({ error: "Invalid filename" })
            return
        }
        const updateFileSize =
            body.updateFileSize != null && Number.isFinite(Number(body.updateFileSize))
                ? Number(body.updateFileSize)
                : null
        const updateSha512 =
            typeof body.updateSha512 === "string" && body.updateSha512.trim() ? body.updateSha512.trim() : null
        const releaseNotes = typeof body.releaseNotes === "string" ? body.releaseNotes.slice(0, 4000) : null
        const publishLatest = body.publishLatest === true
        let row = await registerRelease({
            version,
            platform,
            filename,
            updateFilename,
            fileSize,
            updateFileSize,
            sha512,
            updateSha512,
            releaseNotes
        })
        if (publishLatest) {
            const patched = await patchRelease(row.id, { isLatest: true, isPublished: true })
            if (patched) row = patched
        }
        res.status(201).json({ release: releaseRowToAdminDto(row) })
    } catch (e) {
        console.error("admin/releases/register", e)
        res.status(500).json({ error: "Server error" })
    }
})

router.get("/releases", ...adminProtect, async (req, res) => {
    try {
        const rows = await listReleases()
        res.json({ releases: rows.map(releaseRowToAdminDto) })
    } catch (e) {
        console.error("admin/releases get", e)
        res.status(500).json({ error: "Server error" })
    }
})

router.patch("/releases/:id", ...adminProtect, json({ limit: "16kb" }), async (req, res) => {
    try {
        const uid = null
        const id = parseAdminId(req.params.id)
        if (id === null) {
            res.status(400).json({ error: "Invalid id" })
            return
        }
        const existing = await pool.query<{
            is_published: boolean
            is_latest: boolean
            version: string
            platform: string
        }>("SELECT is_published, is_latest, version, platform FROM app_releases WHERE id = $1", [id])
        const before = existing.rows[0]
        const body = req.body as {
            is_published?: unknown
            is_latest?: unknown
            release_notes?: unknown
        }
        const patch: {
            isPublished?: boolean
            isLatest?: boolean
            releaseNotes?: string | null
        } = {}
        if (typeof body.is_published === "boolean") patch.isPublished = body.is_published
        if (typeof body.is_latest === "boolean") patch.isLatest = body.is_latest
        if (body.release_notes === null) patch.releaseNotes = null
        if (typeof body.release_notes === "string") patch.releaseNotes = body.release_notes.slice(0, 4000)
        const row = await patchRelease(id, patch)
        if (!row) {
            res.status(404).json({ error: "Not found" })
            return
        }
        if (before) {
            if (patch.isPublished === true && !before.is_published) {
                await logAdminAction({
                    adminUserId: uid,
                    action: "release.publish",
                    details: {
                        clientIp: resolveClientIp(req),
                        releaseId: id,
                        version: before.version,
                        platform: before.platform
                    }
                })
            } else if (patch.isPublished === false && before.is_published) {
                await logAdminAction({
                    adminUserId: uid,
                    action: "release.unpublish",
                    details: {
                        clientIp: resolveClientIp(req),
                        releaseId: id,
                        version: before.version,
                        platform: before.platform
                    }
                })
            }
            if (patch.isLatest === true && !before.is_latest) {
                await logAdminAction({
                    adminUserId: uid,
                    action: "release.latest",
                    details: {
                        clientIp: resolveClientIp(req),
                        releaseId: id,
                        version: before.version,
                        platform: before.platform
                    }
                })
            }
            if (patch.releaseNotes !== undefined) {
                await logAdminAction({
                    adminUserId: uid,
                    action: "release.notes",
                    details: {
                        clientIp: resolveClientIp(req),
                        releaseId: id,
                        version: before.version,
                        platform: before.platform
                    }
                })
            }
        }
        res.json({ release: releaseRowToAdminDto(row) })
    } catch (e) {
        console.error("admin/releases patch", e)
        res.status(500).json({ error: "Server error" })
    }
})

export default router
