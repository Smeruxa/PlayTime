import express, { type Request } from "express"
import { isIP } from "node:net"
import { redis } from "../../shared/config"
import { resolveClientIp } from "../../shared/http/clientIp"
import { adminSessionMiddleware } from "../middlewares/adminSessionMiddleware"
import { adminWriteMiddleware } from "../middlewares/adminWriteMiddleware"
import {
    getSiteVisitStats,
    PUBLIC_SITE_PAGES,
    recordSiteVisit,
    VISIT_BUDGET_SCRIPT,
    visitBudgetIpHash
} from "../analytics/siteVisits"

function allowedOrigin(req: Request): boolean {
    const origin = req.get("Origin")
    if (!origin) return false
    const configured = process.env.SITE_ORIGIN?.trim()
    if (configured) {
        try {
            const canonical = new URL(configured)
            if (!["https:", "http:"].includes(canonical.protocol)) return false
            const origins = new Set([canonical.origin])
            if (canonical.hostname.includes(".") && !isIP(canonical.hostname)) {
                canonical.hostname = canonical.hostname.startsWith("www.")
                    ? canonical.hostname.slice(4)
                    : `www.${canonical.hostname}`
                origins.add(canonical.origin)
            }
            if (origins.has(origin)) return true
        } catch {
            return false
        }
    }
    if (process.env.NODE_ENV === "production") return false
    const dev = process.env.SITE_DEV_ORIGIN?.trim() || "http://localhost:5173"
    return [dev, dev.replace("://localhost:", "://127.0.0.1:"), "http://127.0.0.1:5173"].includes(origin)
}

export const siteAnalyticsRouter = express.Router()
siteAnalyticsRouter.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store")
    next()
})
siteAnalyticsRouter.post(
    "/visit",
    async (req, res, next) => {
        if (!allowedOrigin(req) || req.get("Sec-Fetch-Site") === "cross-site") {
            res.status(403).json({ error: "Forbidden" })
            return
        }
        if (!req.is("application/json")) {
            res.status(415).json({ error: "Expected JSON" })
            return
        }
        try {
            const ipHash = visitBudgetIpHash(resolveClientIp(req))
            const wait = Number(
                await redis.eval(VISIT_BUDGET_SCRIPT, 2, "site-visits:budget:global", `site-visits:budget:${ipHash}`)
            )
            if (wait > 0) {
                res.setHeader("Retry-After", String(wait))
                res.status(429).json({ error: "Too many requests" })
                return
            }
            next()
        } catch {
            res.status(503).json({ error: "Analytics unavailable" })
        }
    },
    express.json({ limit: "256b", strict: true }),
    async (req, res) => {
        if (
            typeof req.body?.sessionId !== "string" ||
            !/^[a-f0-9]{32}$/.test(req.body.sessionId) ||
            !PUBLIC_SITE_PAGES.includes(req.body?.page) ||
            Object.keys(req.body).some((key) => key !== "sessionId" && key !== "page")
        ) {
            res.status(400).json({ error: "Invalid visit" })
            return
        }
        try {
            await recordSiteVisit(req.body.sessionId)
            res.sendStatus(204)
        } catch {
            res.status(503).json({ error: "Analytics unavailable" })
        }
    }
)
siteAnalyticsRouter.use(
    (error: { type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(error.type === "entity.too.large" ? 413 : 400).json({ error: "Invalid visit" })
    }
)

export const siteAnalyticsAdminRouter = express.Router()
siteAnalyticsAdminRouter.use(adminSessionMiddleware, adminWriteMiddleware)
siteAnalyticsAdminRouter.get("/", async (_req, res) => {
    try {
        res.json({ visits: await getSiteVisitStats() })
    } catch {
        res.status(503).json({ error: "Не удалось загрузить посещаемость" })
    }
})
