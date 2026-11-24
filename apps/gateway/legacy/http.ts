import { json, Router } from "express"
import { moderateAccount } from "../../auth-api/auth/moderateAccount"
import { verifyBearerAccess } from "../../auth-api/http/bearerAuthMiddleware"
import { isRecoveryMailConfigured } from "../../auth-api/services/recoveryMail"
import authPublicRoutes from "../../auth-api/http/publicRoutes"
import chatPublicRoutes from "../../chat-api/http/publicRoutes"
import { listPeerReports, resolvePeerReport } from "../../chat-api/services/reports"
import type { FeatureIo } from "../../shared/socket/featureContext"
import { createApp } from "../http/createApp"
import { createLegacyPeerBlockEffects } from "./peerBlockEffects"

export function createLegacyApp() {
    const routes = Router()
    routes.use(json({ limit: "32kb" }))
    routes.use(authPublicRoutes, chatPublicRoutes)
    const app = createApp({
        domainRoutes: routes,
        moderateAccount,
        verifyBearerAccess,
        getRecoveryMailStatus: async () => isRecoveryMailConfigured(),
        reports: { list: listPeerReports, resolve: resolvePeerReport }
    })
    app.locals.peerBlockEffects = createLegacyPeerBlockEffects((): FeatureIo | undefined => app.get("io"))
    return app
}
