import fs from "fs"
import path from "path"
import express from "express"
import multer from "multer"
import { pool } from "../../shared/config"
import { bearerAuthMiddleware, type AuthedRequest } from "../../shared/http/bearerAuth"
import {
    attachmentBaseDir,
    attachmentFinalPath,
    attachmentStagingPath,
    ensureAttachmentDirs
} from "../services/attachments"
import { sanitizeContentDispositionFilename } from "../../shared/files/safeFilename"
import { finishMediaUpload, reserveUpload, MEDIA_ENCRYPTION_OVERHEAD } from "../services/mediaStorage"
import { canSeeRoomMessage } from "../socket/messages/visibility"

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        ensureAttachmentDirs()
        cb(null, path.join(attachmentBaseDir(), "staging"))
    },
    filename: (req, _file, cb) => {
        cb(null, req.mediaUpload!.key)
    }
})

const router = express.Router()

router.post(
    "/upload",
    bearerAuthMiddleware,
    reserveUpload(
        "attachment",
        (limits) => limits.maxAttachmentBytes + MEDIA_ENCRYPTION_OVERHEAD
    ),
    (req, res, next) => {
        const upload = multer({
            storage,
            limits: { fileSize: req.mediaUpload!.maxBytes + 1, fields: 0, files: 1, parts: 1 },
            fileFilter: (_req, file, cb) => {
                const mime = (file.mimetype || "").toLowerCase()
                if (mime === "application/octet-stream") cb(null, true)
                else cb(new Error("Неподдерживаемый тип файла"))
            }
        }).single("file")
        upload(req, res, (err) => {
            if (err) {
                const msg = err instanceof Error ? err.message : "Upload failed"
                return res.status(400).json({ error: msg })
            }
            next()
        })
    },
    async (req, res) => {
        const uid = (req as AuthedRequest).userId
        const { maxBytes } = req.mediaUpload!
        const file = req.file
        if (!file?.filename) return res.status(400).json({ error: "No file" })
        if (file.size <= MEDIA_ENCRYPTION_OVERHEAD || file.size > maxBytes) {
            try {
                await fs.promises.unlink(file.path)
            } catch {}
            const mb = Math.round(maxBytes / (1024 * 1024))
            return res.status(400).json({ error: `Файл больше лимита тарифа (${mb} МБ)` })
        }
        const attachmentKey = file.filename
        const mime = "application/octet-stream"
        const filename = "attachment.bin"
        try {
            await finishMediaUpload(attachmentKey, file.size)
            await pool.query(
                "INSERT INTO attachment_staging (attachment_key, user_id, mime, filename, size_bytes) VALUES ($1, $2, $3, $4, $5)",
                [attachmentKey, uid, mime, filename, file.size]
            )
            return res.json({ attachmentKey, mime, filename, sizeBytes: file.size })
        } catch (e) {
            console.error("attachment upload", e)
            try {
                await fs.promises.unlink(file.path)
            } catch {}
            return res.status(500).json({ error: "Server error" })
        }
    }
)

router.get("/:attachmentKey", bearerAuthMiddleware, async (req, res) => {
    const uid = (req as AuthedRequest).userId
    const attachmentKey = String(req.params.attachmentKey || "").replace(/[^a-zA-Z0-9-]/g, "")
    if (!attachmentKey || attachmentKey.length > 48) return res.status(400).end()

    const msg = await pool.query<{
        id: number
        room_id: number | null
        sender_id: number
        receiver_id: number | null
        attachment_mime: string | null
        attachment_filename: string | null
    }>(
        `SELECT id, room_id, sender_id, receiver_id, attachment_mime, attachment_filename
         FROM messages WHERE attachment_storage_key = $1 LIMIT 1`,
        [attachmentKey]
    )
    const sendFile = (filePath: string, mime: string, filename: string) => {
        if (!fs.existsSync(filePath)) return res.status(404).end()
        const safeName = sanitizeContentDispositionFilename(filename)
        res.setHeader("Content-Type", "application/octet-stream")
        res.setHeader("Content-Disposition", `attachment; filename="${safeName.replace(/"/g, "")}"`)
        res.setHeader("X-Content-Type-Options", "nosniff")
        res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox")
        return res.sendFile(path.resolve(filePath), (err) => {
            if (err && !res.headersSent) res.status(500).end()
        })
    }

    if (msg.rows.length > 0) {
        const m = msg.rows[0]
        if (m.room_id != null) {
            if (!(await canSeeRoomMessage(uid, m.room_id, m.id))) return res.status(403).end()
        } else if (m.receiver_id != null) {
            if (m.sender_id !== uid && m.receiver_id !== uid) return res.status(403).end()
        } else return res.status(404).end()
        const final = attachmentFinalPath(attachmentKey)
        return sendFile(final, m.attachment_mime || "application/octet-stream", m.attachment_filename || "file")
    }

    const st = await pool.query(
        "SELECT mime, filename FROM attachment_staging WHERE attachment_key = $1 AND user_id = $2",
        [attachmentKey, uid]
    )
    if (st.rows.length === 0) return res.status(404).end()
    const staging = attachmentStagingPath(attachmentKey)
    return sendFile(staging, st.rows[0].mime, st.rows[0].filename)
})

export default router
