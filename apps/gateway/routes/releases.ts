import express from "express"
import {
    buildFeedForPlatform,
    getLatestPublishedMap,
    parseReleasePlatform
} from "../releases/releaseService"

const router = express.Router()

router.get("/latest", async (_req, res) => {
    try {
        const releases = await getLatestPublishedMap()
        res.setHeader("Cache-Control", "no-store")
        res.json({ releases })
    } catch (e) {
        console.error("releases/latest", e)
        res.status(500).json({ error: "Server error" })
    }
})

function sendManualDownload(res: express.Response): void {
    res.setHeader("Cache-Control", "no-store")
    res.status(410).json({ error: "Загрузите установщик Windows на сайте PlayTime." })
}

async function sendMacFeed(res: express.Response): Promise<void> {
    try {
        const yaml = await buildFeedForPlatform("darwin")
        if (!yaml) {
            res.status(404).json({ error: "No published release" })
            return
        }
        res.setHeader("Content-Type", "text/yaml; charset=utf-8")
        res.setHeader("Cache-Control", "public, max-age=300")
        res.send(yaml)
    } catch (e) {
        console.error("releases/feed darwin", e)
        res.status(500).json({ error: "Server error" })
    }
}

router.get("/feed/:platform", (req, res) => {
    const platform = parseReleasePlatform(String(req.params.platform ?? ""))
    if (platform === "win32") return sendManualDownload(res)
    if (platform === "darwin") return sendMacFeed(res)
    res.status(400).json({ error: "Invalid platform" })
})

router.get("/feed/darwin/latest-mac.yml", (_req, res) => sendMacFeed(res))
router.get("/feed/win32/latest.yml", (_req, res) => sendManualDownload(res))

export default router
