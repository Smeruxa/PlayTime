import { Router, type RequestHandler } from "express"
import { changeGuestEmail } from "./guestEmail"
import { enterGuest } from "./guestEntry"
import { upgradeGuest } from "./guestUpgrade"

export function createGuestRoutes(limiter: RequestHandler) {
    const router = Router()
    router.post("/guest", limiter, enterGuest)
    router.post("/guest/upgrade", limiter, upgradeGuest)
    router.post("/guest/change-email", limiter, changeGuestEmail)
    return router
}
