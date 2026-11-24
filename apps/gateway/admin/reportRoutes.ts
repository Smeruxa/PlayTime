import { Router } from "express"
import { isReportId, latestReportCursor, type ChatReport } from "../../shared/runtime/chatContracts"
import { adminProtect } from "./routeGuards"

export type ReportModeration = {
    list(beforeId: string): Promise<ChatReport[]>
    resolve(reportId: string): Promise<void>
}

export function createAdminReportRoutes(reports: ReportModeration) {
    const router = Router()
    router.use(...adminProtect)
    router.get("/", async (req, res) => {
        const beforeId = isReportId(req.query.beforeId) ? req.query.beforeId : latestReportCursor
        try {
            res.json({ reports: await reports.list(beforeId) })
        } catch {
            res.status(503).json({ error: "Не удалось загрузить жалобы" })
        }
    })
    router.post("/:id/resolve", async (req, res) => {
        if (!isReportId(req.params.id)) return res.status(400).json({ error: "Некорректная жалоба" })
        try {
            await reports.resolve(req.params.id)
            return res.json({ ok: true })
        } catch {
            return res.status(503).json({ error: "Не удалось закрыть жалобу" })
        }
    })
    return router
}
