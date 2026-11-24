import { Router } from "express"
import { getSitePublicPath } from "../http/serveSite"
import { createOverviewRoutes } from "./overviewRoutes"
import { createUserRoutes, type AccountModerator } from "./userRoutes"
import releaseRoutes from "./releaseRoutes"

export function createAdminRoutes(moderate: AccountModerator, getRecoveryMailStatus: () => Promise<boolean>) {
    const adminRouter = Router()
    adminRouter.use((req, res, next) => {
        if (req.method === "GET" && req.get("accept")?.includes("text/html")) {
            const target = req.path === "/users" ? "people" : req.path === "/audit" ? "activity" : null
            if (target) {
                res.redirect(302, `${getSitePublicPath()}/admin/${target}`)
                return
            }
        }
        next()
    })
    adminRouter.use(createOverviewRoutes(getRecoveryMailStatus), createUserRoutes(moderate), releaseRoutes)

    return adminRouter
}
