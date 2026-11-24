import { createHash, timingSafeEqual } from "node:crypto"
import { isIP } from "node:net"
import type { Request, Response, NextFunction } from "express"
import rateLimit, { ipKeyGenerator } from "express-rate-limit"
import { RedisStore, type RedisReply } from "rate-limit-redis"
import { redis } from "../../shared/config"
import { resolveClientIp } from "../../shared/http/clientIp"

export const releaseRegistrationLimiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        const clientIp = resolveClientIp(req)
        return isIP(clientIp) ? ipKeyGenerator(clientIp, 56) : "unknown"
    },
    store: new RedisStore({
        prefix: "rl:gateway:release-registration:",
        sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<RedisReply>
    }),
    message: { error: "Too many release registration requests" }
})

export function releaseRegisterSecretMiddleware(req: Request, res: Response, next: NextFunction): void {
    const expected = process.env.RELEASE_REGISTER_SECRET?.trim()
    if (!expected) {
        res.status(503).json({ error: "Release register is not configured" })
        return
    }
    const got = req.header("x-release-register-secret")?.trim()
    const digest = (value: string) => createHash("sha256").update(value).digest()
    if (!got || !timingSafeEqual(digest(got), digest(expected))) {
        res.status(403).json({ error: "Forbidden" })
        return
    }
    next()
}
