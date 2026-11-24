import { json, Router } from "express"
import { isIP } from "node:net"
import { requireGatewayModerator } from "../shared/runtime/moderationAuth"
import type { FeatureIo } from "../shared/socket/featureContext"
import { moderateAccount } from "./auth/moderateAccount"
import { isRecoveryMailConfigured } from "./services/recoveryMail"

export function createAccountRoutes(io: FeatureIo) {
    const router = Router()
    router.post("/recovery-mail", (_req, res) => res.json({ configured: isRecoveryMailConfigured() }))
    router.post<Record<string, string>, unknown, unknown>("/block", requireGatewayModerator, json({ limit: "4kb" }), async (req, res) => {
        const body = req.body
        if (
            !body ||
            typeof body !== "object" ||
            !("userId" in body) ||
            !("blocked" in body) ||
            !("reason" in body) ||
            !("clientIp" in body)
        ) {
            return res.sendStatus(400)
        }
        const { userId, blocked, reason, clientIp } = body
        if (
            typeof userId !== "number" ||
            !Number.isInteger(userId) ||
            userId < 1 ||
            userId > 2147483647 ||
            typeof blocked !== "boolean" ||
            typeof clientIp !== "string" ||
            !isIP(clientIp) ||
            (reason !== null && (typeof reason !== "string" || reason.length > 500))
        )
            return res.sendStatus(400)
        res.json(await moderateAccount({ userId, blocked, reason, clientIp }, io))
    })
    return router
}
