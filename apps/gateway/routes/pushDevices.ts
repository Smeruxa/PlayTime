import express from "express"
import { bearerAuthMiddleware, type AuthedRequest } from "../../shared/http/bearerAuth"
import { PushRegistrationSessionError, registerPushDevice, removePushDevice } from "../push/repository"
import { parsePushRegistration } from "../push/validation"
import { readPushConfig } from "../push/rustore"

const router = express.Router()
router.use(bearerAuthMiddleware)

router.put("/device", async (req, res) => {
    const { userId, accessSession } = req as AuthedRequest
    const input = parsePushRegistration(req.body)
    if (!input) {
        res.status(400).json({ error: "Некорректные настройки уведомлений" })
        return
    }
    if (!accessSession.sessionId) {
        res.status(409).json({ error: "Войдите в аккаунт заново для подключения уведомлений" })
        return
    }
    try {
        await registerPushDevice(userId, accessSession.sessionId, input)
        res.json({ registered: true, deliveryReady: !!readPushConfig() })
    } catch (error) {
        if (error instanceof PushRegistrationSessionError) {
            res.status(401).json({ error: "Сеанс завершён. Войдите в аккаунт заново." })
            return
        }
        res.status(503).json({ error: "Не удалось сохранить настройки уведомлений. Повторите попытку." })
    }
})

router.delete("/device", async (req, res) => {
    const { userId, accessSession } = req as AuthedRequest
    try {
        if (accessSession.sessionId) {
            await removePushDevice(userId, accessSession.sessionId)
        }
        res.json({ removed: true })
    } catch {
        res.status(503).json({ error: "Не удалось отключить серверные уведомления. Повторите попытку." })
    }
})

export default router
