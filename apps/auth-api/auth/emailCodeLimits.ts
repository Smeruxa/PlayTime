import { createHmac } from "node:crypto"
import type { Redis } from "ioredis"

const DAY_SECONDS = 24 * 60 * 60
const BLOCK_SECONDS = 12 * 60 * 60
const ACCOUNT_FAILURE_LIMIT = 15
const DAILY_EMAIL_LIMIT = 8

type EmailCodePurpose = "recovery" | "verification"

const RECORD_FAILURE = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
if count >= tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'EX', ARGV[3], 'NX')
end
return count
`

const CLAIM_DELIVERY = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count >= tonumber(ARGV[1]) then return 0 end
if redis.call('INCR', KEYS[1]) == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return 1
`

export function createEmailCodeLimits(redis: Pick<Redis, "mget" | "eval">, secret: string) {
    function accountKeys(purpose: EmailCodePurpose, userId: number) {
        return [`auth:email-codes:${purpose}:${userId}:failures`, `auth:email-codes:${purpose}:${userId}:blocked`] as const
    }

    return {
        async canTry(purpose: EmailCodePurpose, userId: number): Promise<boolean> {
            const [count, block] = await redis.mget(...accountKeys(purpose, userId))
            return block === null && Number(count ?? 0) < ACCOUNT_FAILURE_LIMIT
        },
        async recordFailure(purpose: EmailCodePurpose, userId: number): Promise<void> {
            await redis.eval(RECORD_FAILURE, 2, ...accountKeys(purpose, userId), DAY_SECONDS, ACCOUNT_FAILURE_LIMIT, BLOCK_SECONDS)
        },
        async claimDelivery(email: string): Promise<boolean> {
            const address = createHmac("sha256", secret).update(email.trim().toLowerCase()).digest("hex")
            const key = `auth:email-codes:delivery:${address}`
            return (await redis.eval(CLAIM_DELIVERY, 1, key, DAILY_EMAIL_LIMIT, DAY_SECONDS)) === 1
        }
    }
}
