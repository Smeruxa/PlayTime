import { setTimeout as delay } from "node:timers/promises"
import { redis } from "../../../shared/redis"
import { tryLease } from "../../lease"

const queues = new Map<number, { tail: Promise<void>; waiting: number }>()
const leaseDuration = 60_000
const acquireTimeout = 3_000

export async function withVoiceRoomLock<T>(roomId: number, work: (renew: () => Promise<void>) => Promise<T>): Promise<T> {
    const queue = queues.get(roomId) || { tail: Promise.resolve(), waiting: 0 }
    if (queue.waiting >= 20) throw new Error("Room voice queue busy")
    queue.waiting++
    queues.set(roomId, queue)
    const previous = queue.tail
    let release!: () => void
    queue.tail = new Promise<void>((resolve) => {
        release = resolve
    })
    await previous
    try {
        const key = `room:voice:admission:${roomId}`
        const deadline = performance.now() + acquireTimeout
        while (performance.now() < deadline) {
            const lease = await tryLease(redis, key, leaseDuration)
            if (lease) {
                try {
                    return await work(lease.renew)
                } finally {
                    await lease.release().catch(() => console.error("Voice room lease release failed"))
                }
            }
            await delay(50 + Math.random() * 50)
        }
        throw new Error("Room voice lease busy")
    } finally {
        queue.waiting--
        release()
        if (!queue.waiting) queues.delete(roomId)
    }
}
