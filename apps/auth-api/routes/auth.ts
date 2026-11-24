import { Router } from "express"
import { redis } from "../../shared/config"
import { createAuthRateLimiters } from "../http/authRateLimits"
import { createCredentialRoutes } from "./auth/credentials"
import { createGuestRoutes } from "./auth/guest"
import { createPasswordRoutes } from "./auth/password"

const router = Router()
const limiters = createAuthRateLimiters(redis)
router.use(
    createGuestRoutes(limiters.loginRegisterLimiter),
    createPasswordRoutes(limiters.loginRegisterLimiter),
    createCredentialRoutes(limiters)
)

export default router
