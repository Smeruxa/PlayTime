import { Router } from "express"
import { bearerAuthMiddleware, type AuthedRequest } from "../../shared/http/bearerAuth"
import { listPlansPublic } from "../../shared/subscription/planCatalog"
import { getLimitsForUser } from "../subscription/subscriptionService"

const router = Router()

router.get("/plans", (_req, res) => {
    res.json({ plans: listPlansPublic() })
})

router.get("/me", bearerAuthMiddleware, async (req, res) => {
    try {
        const uid = (req as AuthedRequest).userId
        const data = await getLimitsForUser(uid)
        res.json({ planSlug: data.planSlug, limits: data.limits })
    } catch (e) {
        console.error("subscription/me", e)
        res.status(500).json({ error: "Server error" })
    }
})

export default router
