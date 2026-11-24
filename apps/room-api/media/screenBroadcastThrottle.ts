import type Redis from "ioredis"

export async function allowScreenFrame(redis: Pick<Redis, "set">, userId: number, maxFps: number): Promise<boolean> {
    if (!Number.isFinite(maxFps) || maxFps <= 0) return false
    const interval = Math.max(1, Math.floor(1000 / Math.min(maxFps, 60)))
    return (await redis.set(`screen:frame:${userId}`, "1", "PX", interval, "NX")) === "OK"
}
