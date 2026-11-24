import path from "node:path"
import express from "express"
import {
    parseReleasePlatform,
    resolveLatestPublicDownload,
    type ReleasePlatform
} from "../releases/releaseService"
import { sanitizeContentDispositionFilename } from "../../shared/files/safeFilename"

const router = express.Router()

function contentTypeForFilename(filename: string): string {
    const ext = path.extname(filename).toLowerCase()
    if (ext === ".zip") return "application/zip"
    if (ext === ".exe") return "application/vnd.microsoft.portable-executable"
    return "application/octet-stream"
}

async function sendReleaseFile(
    platform: ReleasePlatform,
    filename: string,
    res: express.Response
): Promise<void> {
    const resolved = await resolveLatestPublicDownload(platform, filename)
    if (!resolved) {
        res.status(404).json({ error: "Not found" })
        return
    }

    const safeName = sanitizeContentDispositionFilename(filename)
    res.setHeader("Content-Type", contentTypeForFilename(filename))
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`)
    res.setHeader("Cache-Control", "public, max-age=3600")
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.sendFile(resolved.filePath)
}

router.head("/:platform/:filename", async (req, res) => {
    try {
        const platform = parseReleasePlatform(String(req.params.platform ?? ""))
        const filename = path.basename(String(req.params.filename ?? ""))
        if (!platform) {
            res.status(400).end()
            return
        }
        const resolved = await resolveLatestPublicDownload(platform, filename)
        if (!resolved) {
            res.status(404).end()
            return
        }
        res.setHeader("Content-Type", contentTypeForFilename(filename))
        res.setHeader("Content-Length", String(resolved.fileSize))
        res.status(200).end()
    } catch (e) {
        console.error("releases/download head", e)
        res.status(500).end()
    }
})

router.get("/:platform/:filename", async (req, res) => {
    try {
        const platform = parseReleasePlatform(String(req.params.platform ?? ""))
        const filename = path.basename(String(req.params.filename ?? ""))
        if (!platform) {
            res.status(400).json({ error: "Invalid platform" })
            return
        }
        await sendReleaseFile(platform, filename, res)
    } catch (e) {
        console.error("releases/download get", e)
        if (!res.headersSent) res.status(500).json({ error: "Server error" })
    }
})

export default router
