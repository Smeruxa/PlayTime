import fs from "fs"
import path from "path"
import express from "express"
import multer from "multer"
import { pool } from "../../shared/config"
import { bearerAuthMiddleware, type AuthedRequest } from "../../shared/http/bearerAuth"
import { ensureVoiceDirs, voiceBaseDir, voiceFinalPath, voiceStagingPath } from "../services/voiceMessages"
import { finishMediaUpload, reserveUpload, MEDIA_ENCRYPTION_OVERHEAD } from "../services/mediaStorage"
import { voiceReservationLimit } from "../services/mediaQuota"
import { canSeeRoomMessage } from "../socket/messages/visibility"

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        ensureVoiceDirs()
        cb(null, path.join(voiceBaseDir(), "staging"))
    },
    filename: (req, _file, cb) => {
        cb(null, `${req.mediaUpload!.key}.webm`)
    }
})

const router = express.Router()

router.post(
    "/upload",
    bearerAuthMiddleware,
    reserveUpload("voice", (limits) => voiceReservationLimit(limits.maxVoiceMessageSec) + MEDIA_ENCRYPTION_OVERHEAD),
    (req, res, next) => {
        const upload = multer({
            storage,
            limits: { fileSize: req.mediaUpload!.maxBytes + 1, fields: 1, fieldSize: 32, files: 1, parts: 2 },
            fileFilter: (_req, file, cb) => {
                if (file.mimetype === "application/octet-stream") cb(null, true)
                else cb(new Error("Unsupported audio type"))
            }
        })
        upload.single("file")(req, res, (err) => {
            if (err) {
                const msg = err instanceof Error ? err.message : "Upload failed"
                return res.status(400).json({ error: msg })
            }
            next()
        })
    },
    async (req, res) => {
        const uid = (req as AuthedRequest).userId
        const { limits, maxBytes } = req.mediaUpload!
        const file = req.file
        if (!file?.filename) return res.status(400).json({ error: "No file" })
        const voiceKey = path.basename(file.filename, path.extname(file.filename))
        const durRaw = (req.body as { durationSec?: string }).durationSec
        const durationSec = parseFloat(typeof durRaw === "string" ? durRaw : String(durRaw ?? ""))
        if (
            file.size <= MEDIA_ENCRYPTION_OVERHEAD ||
            file.size > maxBytes ||
            !Number.isFinite(durationSec) ||
            durationSec <= 0 ||
            durationSec > limits.maxVoiceMessageSec
        ) {
            try {
                await fs.promises.unlink(file.path)
            } catch {}
            return res.status(400).json({ error: "Invalid durationSec" })
        }
        try {
            await finishMediaUpload(voiceKey, file.size)
            await pool.query("INSERT INTO voice_staging (voice_key, user_id, duration_sec) VALUES ($1, $2, $3)", [
                voiceKey,
                uid,
                durationSec
            ])
            return res.json({ voiceKey })
        } catch (e) {
            console.error("voice upload", e)
            try {
                await fs.promises.unlink(file.path)
            } catch {}
            return res.status(500).json({ error: "Server error" })
        }
    }
)

router.get("/:voiceKey", bearerAuthMiddleware, async (req, res) => {
    const uid = (req as AuthedRequest).userId
    const voiceKey = String(req.params.voiceKey || "").replace(/[^a-zA-Z0-9-]/g, "")
    if (!voiceKey || voiceKey.length > 48) return res.status(400).end()

    const msg = await pool.query<{
        id: number
        room_id: number | null
        sender_id: number
        receiver_id: number | null
    }>(`SELECT id, room_id, sender_id, receiver_id FROM messages WHERE voice_storage_key = $1 LIMIT 1`, [voiceKey])
    if (msg.rows.length > 0) {
        const m = msg.rows[0]
        if (m.room_id != null) {
            if (!(await canSeeRoomMessage(uid, m.room_id, m.id))) return res.status(403).end()
        } else if (m.receiver_id != null) {
            if (m.sender_id !== uid && m.receiver_id !== uid) return res.status(403).end()
        } else return res.status(404).end()
        const final = voiceFinalPath(voiceKey)
        if (!fs.existsSync(final)) return res.status(404).end()
        return res.sendFile(
            path.resolve(final),
            {
                headers: {
                    "Content-Type": "application/octet-stream",
                    "Content-Disposition": "attachment",
                    "X-Content-Type-Options": "nosniff"
                }
            },
            (err) => {
                if (err && !res.headersSent) res.status(500).end()
            }
        )
    }

    const st = await pool.query("SELECT 1 FROM voice_staging WHERE voice_key = $1 AND user_id = $2", [voiceKey, uid])
    if (st.rows.length === 0) return res.status(404).end()
    const staging = voiceStagingPath(voiceKey)
    if (!fs.existsSync(staging)) return res.status(404).end()
    return res.sendFile(
        path.resolve(staging),
        {
            headers: {
                "Content-Type": "application/octet-stream",
                "Content-Disposition": "attachment",
                "X-Content-Type-Options": "nosniff"
            }
        },
        (err) => {
            if (err && !res.headersSent) res.status(500).end()
        }
    )
})

export default router
