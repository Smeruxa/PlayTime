import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { isIP } from "node:net"
import { ipKeyGenerator } from "express-rate-limit"
import { JWT_SECRET } from "../../shared/config"

export const FEEDBACK_COOLDOWN_SECONDS = 15 * 60
export const FORM_MIN_AGE_MS = 3000
const FORM_MAX_AGE_MS = 30 * 60 * 1000

function mac(value: string): string {
    return createHmac("sha256", JWT_SECRET).update(`playtime-feedback:v1:${value}`).digest("hex")
}

export function feedbackIpHash(ip: string): string {
    if (!isIP(ip)) throw new Error("Invalid client address")
    return mac(`ip:${ipKeyGenerator(ip, 56)}`)
}

export function issueFeedbackToken(ipHash: string, now = Date.now()): string {
    const body = `${now}.${randomBytes(16).toString("hex")}`
    return `${body}.${mac(`form:${ipHash}:${body}`)}`
}

export function verifyFeedbackToken(token: unknown, ipHash: string, now = Date.now()): boolean {
    if (typeof token !== "string" || !/^\d{13}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(token)) return false
    const [issued, nonce, signature] = token.split(".")
    const age = now - Number(issued)
    if (age < FORM_MIN_AGE_MS || age > FORM_MAX_AGE_MS) return false
    const expected = mac(`form:${ipHash}:${issued}.${nonce}`)
    return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))
}

export const FEEDBACK_BUDGET_SCRIPT = `
local global = tonumber(redis.call('GET', KEYS[1]) or '0')
if global >= 120 then return math.max(1, redis.call('TTL', KEYS[1])) end
local count = tonumber(redis.call('GET', KEYS[2]) or '0')
if count >= 30 then return math.max(1, redis.call('TTL', KEYS[2])) end
if redis.call('INCR', KEYS[1]) == 1 then redis.call('EXPIRE', KEYS[1], 60) end
if redis.call('INCR', KEYS[2]) == 1 then redis.call('EXPIRE', KEYS[2], 60) end
return 0
`
