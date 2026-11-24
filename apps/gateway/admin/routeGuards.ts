import type { RequestHandler } from "express"
import { adminSessionMiddleware } from "../middlewares/adminSessionMiddleware"
import { adminWriteMiddleware } from "../middlewares/adminWriteMiddleware"

export const adminProtect: RequestHandler[] = [adminSessionMiddleware, adminWriteMiddleware]

export function parseAdminId(value: unknown): number | null {
    if (typeof value !== "string" || !/^\d+$/.test(value)) return null
    const id = Number(value)
    return Number.isSafeInteger(id) && id >= 1 && id <= 2147483647 ? id : null
}
