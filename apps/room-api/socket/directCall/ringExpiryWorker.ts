import type { FeatureIo } from "../../../shared/socket/featureContext"
import { createCallLifecycle } from "./lifecycle"
import { callStore } from "./redisService"

export function startRingExpiryWorker(io: FeatureIo, hasGatewayLinks: () => boolean): () => void {
    const { notifyExpired } = createCallLifecycle(io, undefined)
    let working = false
    const tick = async () => {
        if (working || !hasGatewayLinks()) return
        working = true
        try {
            for (const roomId of await callStore.dueRingDeadlines()) {
                if (!hasGatewayLinks()) return
                const result = await callStore.expirePendingRing(roomId)
                if (result.kind === "ended" && result.room) await notifyExpired(roomId, result.room)
            }
        } catch (error) {
            console.error("Call ring expiry temporarily unavailable", error)
        } finally {
            working = false
        }
    }
    const timer = setInterval(() => void tick(), 1000).unref()
    return () => clearInterval(timer)
}
