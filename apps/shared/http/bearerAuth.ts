import type { Application, Request, RequestHandler } from "express"
import { validSocketToken, type BearerAccessVerifier } from "../runtime/authContracts"
import type { AccessTokenPayload } from "../types/contracts/accessSession"

export type AuthedRequest = Request & { userId: number; username: string; accessSession: AccessTokenPayload }

const verifierKey = "playtime bearer access verifier"

export function configureBearerAccess(app: Application, verify: BearerAccessVerifier): void {
    app.set(verifierKey, verify)
}

export function createBearerAuth(
    verify: (req: Request, token: string) => ReturnType<BearerAccessVerifier>
): RequestHandler {
    return async (req, res, next) => {
        const raw = req.headers.authorization
        const token = typeof raw === "string" && raw.startsWith("Bearer ") ? raw.slice(7).trim() : ""
        if (!validSocketToken(token)) {
            res.status(401).json({ error: "Unauthorized" })
            return
        }
        try {
            const result = await verify(req, token)
            if (result.kind === "blocked") {
                res.status(403).json({ error: "Account blocked" })
                return
            }
            if (result.kind === "invalid") {
                res.status(401).json({ error: "Unauthorized" })
                return
            }
            const authenticated = req as AuthedRequest
            authenticated.userId = result.session.id
            authenticated.username = result.session.username
            authenticated.accessSession = result.session
        } catch {
            res.status(503).json({ error: "Сервис временно недоступен" })
            return
        }
        next()
    }
}

export const bearerAuthMiddleware = createBearerAuth((req, token) => {
    const verify: BearerAccessVerifier = req.app.get(verifierKey)
    return verify(token)
})
