import express from "express"
import { resolveClientIp } from "../../shared/http/clientIp"
import {
    abandonAdminLogin,
    beginAdminLogin,
    clearAdminSessionCookie,
    finishAdminLogin,
    getAdminAccessKeyFingerprint,
    isAdminRequestAllowed,
    readAdminSessionToken,
    revokeAdminSession,
    setAdminSessionCookie,
    type AdminLoginAttempt
} from "../admin/adminSession"

export const adminSessionRouter = express.Router()
adminSessionRouter.use("/session", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store")
    if (!isAdminRequestAllowed(req)) {
        res.status(403).json({ allowed: false, error: "Откройте панель администратора на сайте PlayTime." })
        return
    }
    if (!getAdminAccessKeyFingerprint()) {
        res.status(503).json({ allowed: false, error: "Доступ администратора не настроен." })
        return
    }
    next()
})
adminSessionRouter.post(
    "/session",
    async (req, res, next) => {
        if (!req.is("application/json")) {
            res.status(415).json({ allowed: false, error: "Ожидается JSON." })
            return
        }
        const fingerprint = getAdminAccessKeyFingerprint()!
        const deadline = setTimeout(() => {
            if (!res.headersSent) res.status(408).json({ allowed: false, error: "Время запроса истекло." })
            req.destroy()
        }, 7000)
        deadline.unref()
        const cleanup = () => clearTimeout(deadline)
        res.once("finish", cleanup)
        res.once("close", cleanup)
        try {
            const budget = await beginAdminLogin(resolveClientIp(req), fingerprint)
            if (res.destroyed || res.headersSent) {
                if (budget.attempt) void abandonAdminLogin(budget.attempt).catch(() => {})
                return
            }
            if (!budget.attempt) {
                res.setHeader("Retry-After", String(budget.retryAfter))
                res.status(429).json({
                    allowed: false,
                    error: "Попробуйте войти позже.",
                    retryAfter: budget.retryAfter
                })
                return
            }
            res.locals.adminLoginAttempt = budget.attempt
            res.once("close", () => {
                void abandonAdminLogin(budget.attempt!).catch(() => {})
            })
            next()
        } catch {
            if (!res.destroyed && !res.headersSent)
                res.status(503).json({ allowed: false, error: "Вход временно недоступен." })
        }
    },
    express.json({ limit: "1kb", strict: true }),
    async (req, res) => {
        const attempt = res.locals.adminLoginAttempt as AdminLoginAttempt
        if (
            !req.body ||
            typeof req.body !== "object" ||
            Array.isArray(req.body) ||
            typeof req.body.key !== "string" ||
            req.body.key.length > 256 ||
            Object.keys(req.body).some((key) => key !== "key")
        ) {
            res.status(400).json({ allowed: false, error: "Передайте ключ администратора." })
            return
        }
        try {
            if (getAdminAccessKeyFingerprint() !== attempt.fingerprint) throw new Error("Configuration changed")
            const result = await finishAdminLogin(attempt, req.body.key, readAdminSessionToken(req))
            if (res.destroyed || res.headersSent) return
            if (result.kind !== "allowed") {
                res.setHeader("Retry-After", String(result.retryAfter))
                res.status(result.kind === "invalid" ? 401 : 429).json({
                    allowed: false,
                    error:
                        result.kind === "invalid"
                            ? "Неверный ключ. Вход с этого IP заблокирован на 30 минут."
                            : "Попробуйте войти позже.",
                    retryAfter: result.retryAfter
                })
                return
            }
            setAdminSessionCookie(res, result.token!)
            res.json({ allowed: true, session: result.session })
        } catch {
            if (!res.destroyed && !res.headersSent)
                res.status(503).json({ allowed: false, error: "Вход временно недоступен." })
        }
    }
)
adminSessionRouter.delete("/session", async (req, res) => {
    try {
        const token = readAdminSessionToken(req)
        if (token) await revokeAdminSession(token, getAdminAccessKeyFingerprint()!)
        clearAdminSessionCookie(res)
        res.sendStatus(204)
    } catch {
        res.status(503).json({ allowed: false, error: "Не удалось завершить сеанс. Попробуйте снова." })
    }
})
adminSessionRouter.all("/session", (_req, res) => {
    res.setHeader("Allow", "POST, DELETE")
    res.status(405).json({ allowed: false, error: "Method not allowed" })
})
adminSessionRouter.use(
    (error: { type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(error.type === "entity.too.large" ? 413 : 400).json({
            allowed: false,
            error: "Некорректный запрос входа."
        })
    }
)
