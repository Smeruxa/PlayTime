import { createHmac } from "node:crypto"
import { isIP } from "node:net"
import { ipKeyGenerator } from "express-rate-limit"
import { JWT_SECRET } from "../../shared/config"

export function billingIpHash(ip: string): string {
    if (!isIP(ip)) throw new Error("Invalid client address")
    return createHmac("sha256", JWT_SECRET)
        .update(`billing:ip:${ipKeyGenerator(ip, 56)}`)
        .digest("hex")
}

export const BILLING_BUDGET = `
local global = tonumber(redis.call('GET', KEYS[1]) or '0')
if global >= tonumber(ARGV[1]) then return math.max(1, redis.call('TTL', KEYS[1])) end
local count = tonumber(redis.call('GET', KEYS[2]) or '0')
if count >= tonumber(ARGV[2]) then return math.max(1, redis.call('TTL', KEYS[2])) end
if redis.call('INCR', KEYS[1]) == 1 then redis.call('EXPIRE', KEYS[1], 60) end
if redis.call('INCR', KEYS[2]) == 1 then redis.call('EXPIRE', KEYS[2], 60) end
return 0
`
