import express, { type Express, type RequestHandler } from "express"
import { validateSigningSecret } from "../../shared/config"
import { configureBearerAccess } from "../../shared/http/bearerAuth"
import type { BearerAccessVerifier } from "../../shared/runtime/authContracts"
import { recordRequestMetrics } from "../admin/runtimeMetrics"
import cors from "cors"
import helmet from "helmet"
import pushDeviceRoutes from "../routes/pushDevices"
import feedbackRoutes, { feedbackAdminRouter } from "../routes/feedback"
import { siteAnalyticsAdminRouter, siteAnalyticsRouter } from "../routes/siteAnalytics"
import { adminSessionRouter } from "../routes/adminSession"
import subscriptionRoutes from "../routes/subscription"
import { createAdminRoutes } from "../admin/routes"
import type { AccountModerator } from "../admin/userRoutes"
import { createAdminReportRoutes, type ReportModeration } from "../admin/reportRoutes"
import releasesRoutes from "../routes/releases"
import releaseDownloadsRoutes from "../routes/releaseDownloads"
import billingRoutes from "../routes/billing"
import { attachMarketingSite } from "./serveSite"
import { configureTrustProxy, getCorsOrigin } from "./settings"
import type { GatewaySlot } from "../../shared/runtime/socketProtocol"

export type GatewayServices = {
    gatewaySlot?: GatewaySlot
    domainRoutes: RequestHandler
    moderateAccount: AccountModerator
    verifyBearerAccess: BearerAccessVerifier
    reports: ReportModeration
    getRecoveryMailStatus(): Promise<boolean>
}

export function createApp({
    gatewaySlot,
    domainRoutes,
    moderateAccount,
    verifyBearerAccess,
    reports,
    getRecoveryMailStatus
}: GatewayServices): Express {
    validateSigningSecret()

    const app = express()
    configureBearerAccess(app, verifyBearerAccess)
    app.use(recordRequestMetrics)
    configureTrustProxy(app)
    const CORS_ORIGIN = getCorsOrigin()

    app.use(
        helmet({
            crossOriginResourcePolicy: { policy: "cross-origin" }
        })
    )
    app.use(
        cors({
            origin: CORS_ORIGIN,
            credentials: true
        })
    )
    app.use("/playtime/feedback-api", feedbackRoutes)
    app.use("/playtime/site-analytics", siteAnalyticsRouter)
    app.use("/playtime/admin", adminSessionRouter)
    app.use("/playtime/billing", billingRoutes)
    app.use(domainRoutes)
    app.use(express.json({ limit: "32kb" }))

    app.use("/playtime/push", pushDeviceRoutes)
    app.use("/playtime/admin/tickets", feedbackAdminRouter)
    app.use("/playtime/admin/visits", siteAnalyticsAdminRouter)
    app.use("/playtime/admin/reports", createAdminReportRoutes(reports))
    app.use("/playtime/subscription", subscriptionRoutes)
    app.use("/playtime/admin", createAdminRoutes(moderateAccount, getRecoveryMailStatus))
    app.use("/playtime/releases", releasesRoutes)
    app.use("/playtime/downloads", releaseDownloadsRoutes)

    app.get("/playtime/health", (_req, res) => {
        if (gatewaySlot) res.set("X-PlayTime-Gateway-Slot", gatewaySlot)
        res.json({ ok: true, ts: Date.now() })
    })

    attachMarketingSite(app)

    return app
}
