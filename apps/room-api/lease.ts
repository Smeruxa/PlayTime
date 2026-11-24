import { randomUUID } from "node:crypto"
import type Redis from "ioredis"

const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

const RENEW = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`

export async function tryLease(redis: Pick<Redis, "eval" | "set">, key: string, duration: number) {
    const token = randomUUID()
    if ((await redis.set(key, token, "PX", duration, "NX")) !== "OK") return
    return {
        async renew() {
            if ((await redis.eval(RENEW, 1, key, token, duration)) !== 1) throw new Error("Room lease expired")
        },
        release: async () => {
            await redis.eval(RELEASE, 1, key, token)
        }
    }
}
