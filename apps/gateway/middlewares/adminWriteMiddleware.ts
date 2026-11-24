import type { RequestHandler } from "express"

export const adminWriteMiddleware: RequestHandler = (req, res, next) => {
    res.setHeader("Cache-Control", "no-store")
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get("X-PlayTime-Admin") !== "1") {
        res.status(403).json({ error: "Откройте панель администратора для выполнения действия." })
        return
    }
    next()
}
