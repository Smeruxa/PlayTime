import { Router } from "express"
import { isReportId, latestReportCursor, requestFields, type ChatResponse } from "../shared/runtime/chatContracts"
import { listPeerReports, resolvePeerReport } from "./services/reports"
import { gatewayCredential, gatewayCredentialHeader, matchesCredential } from "../shared/runtime/internalHttp"

const router = Router()
router.use("/reports", (req, res, next) => {
    if (!matchesCredential(req.get(gatewayCredentialHeader), gatewayCredential("CHAT", "reports"))) {
        res.sendStatus(403)
        return
    }
    next()
})

router.post("/reports/list", async (req, res) => {
    const { beforeId } = requestFields(req.body)
    if (!isReportId(beforeId) && beforeId !== latestReportCursor) return res.sendStatus(400)
    const reports = await listPeerReports(beforeId)
    return res.json({ reports } satisfies ChatResponse<"reports/list">)
})

router.post("/reports/resolve", async (req, res) => {
    const { reportId } = requestFields(req.body)
    if (!isReportId(reportId)) return res.sendStatus(400)
    await resolvePeerReport(reportId)
    return res.json({} satisfies ChatResponse<"reports/resolve">)
})

export default router
