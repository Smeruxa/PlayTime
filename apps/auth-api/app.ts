import type { Express } from "express"
import { validateSigningSecret } from "../shared/config"
import type { FeatureIo } from "../shared/socket/featureContext"
import { authAccountsPath, authSessionPath } from "../shared/runtime/authContracts"
import { createAccountRoutes } from "./accountRoutes"
import authPublicRoutes from "./http/publicRoutes"
import sessionRoutes from "./sessionRoutes"
import { startSessionMaintenance } from "./services/sessionMaintenance"

export async function configureAuthApi(app: Express, io: FeatureIo): Promise<() => void> {
    validateSigningSecret()
    app.set("io", io)
    app.use(authPublicRoutes)
    app.use(authSessionPath, sessionRoutes)
    app.use(authAccountsPath, createAccountRoutes(io))
    return startSessionMaintenance(io)
}

export { default as registerAuthSocketFeatures } from "./socket/account"
