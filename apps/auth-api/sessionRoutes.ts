import { validSocketToken } from "../shared/runtime/authContracts"
import { checkSocketSession, isSessionPayload, sessionFailureStatus, verifySocketSession } from "./auth/socketSession"
import { Router, json } from "express"
import { verifyBearerAccess } from "./http/bearerAuthMiddleware"

const router = Router()
router.use(json({ limit: "32kb" }))

router.post<Record<string, string>, unknown, unknown>("/verify", async (req, res) => {
    const body = req.body
    if (!body || typeof body !== "object" || !("token" in body) || !validSocketToken(body.token)) {
        return res.sendStatus(401)
    }
    try {
        res.json(await verifySocketSession(body.token))
    } catch (error) {
        res.sendStatus(sessionFailureStatus(error))
    }
})

router.post<Record<string, string>, unknown, unknown>("/verify-bearer", async (req, res) => {
    const body = req.body
    if (!body || typeof body !== "object" || !("token" in body) || !validSocketToken(body.token)) {
        return res.json({ kind: "invalid" })
    }
    try {
        res.json(await verifyBearerAccess(body.token))
    } catch {
        res.sendStatus(503)
    }
})

router.post<Record<string, string>, unknown, unknown>("/check", async (req, res) => {
    const body = req.body
    if (!body || typeof body !== "object" || !("session" in body) || !isSessionPayload(body.session)) {
        return res.sendStatus(401)
    }
    try {
        await checkSocketSession(body.session)
        res.status(204).end()
    } catch (error) {
        res.sendStatus(sessionFailureStatus(error))
    }
})

export default router
