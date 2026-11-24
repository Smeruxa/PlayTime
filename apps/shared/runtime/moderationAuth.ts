import { timingSafeEqual } from "node:crypto"
import type { RequestHandler } from "express"

export const moderationHeader = "x-playtime-moderation"

export function moderationSecret(): string {
    const secret = process.env.PLAYTIME_MODERATION_SECRET
    if (!secret || secret.length < 32 || secret === process.env.PLAYTIME_INTERNAL_SECRET)
        throw new Error("Configure a dedicated PLAYTIME_MODERATION_SECRET")
    return secret
}

export const requireGatewayModerator: RequestHandler = (req, res, next) => {
    const supplied = Buffer.from(req.get(moderationHeader) ?? "")
    const expected = Buffer.from(moderationSecret())
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
        res.sendStatus(403)
        return
    }
    next()
}
