import type { RequestHandler } from "express"
import {
    getAdminAccessKeyFingerprint,
    isAdminRequestAllowed,
    readAdminSessionToken,
    validateAdminSession
} from "../admin/adminSession"

export const adminSessionMiddleware: RequestHandler = async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store")
    if (!isAdminRequestAllowed(req)) {
        res.status(403).json({ allowed: false, error: "Откройте панель администратора на сайте PlayTime." })
        return
    }
    const fingerprint = getAdminAccessKeyFingerprint()
    if (!fingerprint) {
        res.status(503).json({ allowed: false, error: "Доступ администратора не настроен." })
        return
    }
    const token = readAdminSessionToken(req)
    if (!token) {
        res.status(401).json({ allowed: false, error: "Введите ключ администратора." })
        return
    }
    try {
        const session = await validateAdminSession(token, fingerprint)
        if (!session) {
            res.status(401).json({ allowed: false, error: "Сеанс администратора завершён. Введите ключ снова." })
            return
        }
        res.locals.adminSession = session
        next()
    } catch {
        res.status(503).json({ allowed: false, error: "Проверка доступа временно недоступна." })
    }
}
