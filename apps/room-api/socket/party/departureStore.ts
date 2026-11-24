import type Redis from "ioredis"

const queue = "room:party:departures"
const users = "room:party:departure-users"

const REMEMBER = `
local due = redis.call('ZSCORE', KEYS[1], ARGV[1])
if due and tonumber(due) > tonumber(ARGV[3]) then return end
redis.call('ZADD', KEYS[1], ARGV[3], ARGV[1])
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
`

const REMOVE = `
local due = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not due or (ARGV[2] ~= '' and tonumber(due) > tonumber(ARGV[2])) then return end
local username = redis.call('HGET', KEYS[2], ARGV[1])
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('HDEL', KEYS[2], ARGV[1])
return username
`

type PartyDeparture = { roomId: number; userId: number }

function key({ roomId, userId }: PartyDeparture): string {
    return `${roomId}:${userId}`
}

export function createPartyDepartureStore(redis: Pick<Redis, "eval" | "zrangebyscore">) {
    async function remove(departure: PartyDeparture, now?: number): Promise<string | undefined> {
        const username = await redis.eval(REMOVE, 2, queue, users, key(departure), now ?? "")
        if (typeof username === "string") return username
    }

    return {
        async remember(departure: PartyDeparture, username: string, due: number): Promise<void> {
            await redis.eval(REMEMBER, 2, queue, users, key(departure), username, due)
        },
        async due(now: number): Promise<PartyDeparture[]> {
            const keys = await redis.zrangebyscore(queue, "-inf", now, "LIMIT", 0, 32)
            return keys.map((value) => {
                const [roomId, userId] = value.split(":").map(Number)
                return { roomId, userId }
            })
        },
        remove
    }
}
