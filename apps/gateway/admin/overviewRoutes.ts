import { Router } from "express"
import { resolveClientIp } from "../../shared/http/clientIp"
import { auditRowToDto, listAdminAuditLog } from "./adminAuditLog"
import { getAdminHealth } from "./adminHealth"
import { getAdminStats } from "./adminStats"
import { adminProtect } from "./routeGuards"

export function createOverviewRoutes(getRecoveryMailStatus: () => Promise<boolean>) {
    const router = Router()

    router.get("/access", ...adminProtect, (req, res) => {
        res.json({ allowed: true, clientIp: resolveClientIp(req) })
    })

    router.get("/health", ...adminProtect, async (req, res) => {
        try {
            const health = await getAdminHealth(getRecoveryMailStatus)
            res.json({ health })
        } catch (e) {
            console.error("admin/health", e)
            res.status(500).json({ error: "Server error" })
        }
    })

    router.get("/audit", ...adminProtect, async (req, res) => {
        try {
            const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "40"), 10) || 40))
            const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0)
            const rows = await listAdminAuditLog(limit, offset)
            res.json({ entries: rows.map(auditRowToDto) })
        } catch (e) {
            console.error("admin/audit", e)
            res.status(500).json({ error: "Server error" })
        }
    })

    router.get("/stats", ...adminProtect, async (req, res) => {
        try {
            const stats = await getAdminStats()
            res.json({ stats })
        } catch (e) {
            console.error("admin/stats", e)
            res.status(500).json({ error: "Server error" })
        }
    })

    router.get("/me", ...adminProtect, async (req, res) => {
        try {
            res.json({ isAdmin: true, clientIp: resolveClientIp(req) })
        } catch (e) {
            console.error("admin/me", e)
            res.status(500).json({ error: "Server error" })
        }
    })

    return router
}
