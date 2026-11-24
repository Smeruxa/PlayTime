import express from "express"
import { redis } from "../../shared/config"
import { resolveClientIp } from "../../shared/http/clientIp"
import { bearerAuthMiddleware, type AuthedRequest } from "../../shared/http/bearerAuth"
import { BILLING_BUDGET, billingIpHash } from "../billing/abuse"
import { billingPlans } from "../billing/catalog"
import { readBillingConfig } from "../billing/config"
import { billingService } from "../billing/runtime"
import type { BillingService } from "../billing/orderService"
import { CAPABILITY, parseCheckout, UUID } from "../billing/validation"
import { CheckoutError } from "../billing/types"

export function createBillingRouter(service: BillingService = billingService): express.Router {
    const router = express.Router()
    router.use((_req, res, next) => {
        res.setHeader("Cache-Control", "no-store")
        next()
    })
    router.get("/catalog", (_req, res) => {
        const config = readBillingConfig()
        res.json({ enabled: !!config, mode: config?.mode ?? null, plans: billingPlans() })
    })
    router.use(async (req, res, next) => {
        try {
            const hash = billingIpHash(resolveClientIp(req))
            const kind = req.method === "POST" ? "create" : "status"
            const retryAfter = Number(
                await redis.eval(
                    BILLING_BUDGET,
                    2,
                    `billing:budget:${kind}:global`,
                    `billing:budget:${kind}:${hash}`,
                    kind === "create" ? 120 : 3000,
                    kind === "create" ? 12 : 60
                )
            )
            if (retryAfter > 0) {
                res.setHeader("Retry-After", String(retryAfter))
                res.status(429).json({
                    code: "rate_limited",
                    error: "Слишком много запросов. Попробуйте позже.",
                    retryAfter
                })
                return
            }
            res.locals.billingIpHash = hash
            next()
        } catch {
            res.status(503).json({ code: "billing_unavailable", error: "Оплата временно недоступна." })
        }
    })
    router.use(express.json({ limit: "4kb", strict: true }))
    const fail = (res: express.Response, error: unknown) => {
        if (error instanceof CheckoutError) res.status(error.status).json({ code: error.code, error: error.message })
        else
            res.status(503).json({
                code: "billing_unavailable",
                error: "Оплата временно недоступна. Данные заказа сохранены, повторите проверку."
            })
    }
    router.get("/account", bearerAuthMiddleware, async (req, res) => {
        try {
            res.json(await service.account((req as AuthedRequest).userId))
        } catch (error) {
            fail(res, error)
        }
    })
    router.post("/orders", bearerAuthMiddleware, async (req, res) => {
        try {
            const result = await service.create(
                { ...parseCheckout(req.body), userId: (req as AuthedRequest).userId },
                res.locals.billingIpHash as string
            )
            res.status(result.status === "creating" ? 202 : 200).json(result)
        } catch (error) {
            fail(res, error)
        }
    })
    router.get("/orders/:orderId", async (req, res) => {
        const id = typeof req.params.orderId === "string" ? req.params.orderId : ""
        const authorization = req.headers.authorization
        const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : ""
        if (!UUID.test(id) || !CAPABILITY.test(token)) {
            res.status(404).json({ code: "order_not_found", error: "Заказ недоступен." })
            return
        }
        try {
            res.json(await service.status(id, token))
        } catch (error) {
            fail(res, error)
        }
    })
    router.use((_req, res) => {
        res.status(404).json({ code: "not_found", error: "Метод недоступен." })
    })
    router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        const type = error && typeof error === "object" && "type" in error ? error.type : null
        if (type === "entity.parse.failed" || type === "entity.too.large") {
            res.status(type === "entity.too.large" ? 413 : 400).json({
                code: "invalid_checkout",
                error: "Некорректные данные формы."
            })
        } else {
            res.status(503).json({ code: "billing_unavailable", error: "Оплата временно недоступна." })
        }
    })
    return router
}

export default createBillingRouter()
