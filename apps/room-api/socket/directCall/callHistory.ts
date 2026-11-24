import type Redis from "ioredis"
import { tryLease } from "../../lease"
import { CALL_HISTORY_STREAM } from "./callStore"

const entryLeaseDuration = 15_000

export async function deliverCallHistory(
    redis: Pick<Redis, "eval" | "set" | "xrange" | "xdel">,
    writeCallLog: (entry: unknown) => Promise<unknown>
): Promise<void> {
    const entries = await redis.xrange(CALL_HISTORY_STREAM, "-", "+", "COUNT", 16)
    for (const [id, [, payload]] of entries) {
        const lease = await tryLease(redis, `${CALL_HISTORY_STREAM}:delivery:${id}`, entryLeaseDuration)
        if (!lease) return
        try {
            if (!(await redis.xrange(CALL_HISTORY_STREAM, id, id, "COUNT", 1)).length) continue
            await writeCallLog(JSON.parse(payload))
            await redis.xdel(CALL_HISTORY_STREAM, id)
        } finally {
            await lease.release().catch(() => console.error("Call history lease release failed"))
        }
    }
}
