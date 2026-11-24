import { redis } from "../shared/redis"
import { parseCallHistoryEntry, requestChat } from "../shared/runtime/chatContracts"
import { deliverCallHistory } from "./socket/directCall/callHistory"

export function startCallHistoryWorker(): () => void {
    let flushing = false
    const tick = () => {
        if (flushing) return
        flushing = true
        void deliverCallHistory(redis, async (payload) => {
            const entry = parseCallHistoryEntry(payload)
            if (!entry) throw new Error("Invalid call history entry")
            await requestChat("call-log", entry)
        })
            .catch(() => console.error("Call history delivery temporarily unavailable"))
            .finally(() => {
                flushing = false
            })
    }
    const timer = setInterval(tick, 1000)
    timer.unref()
    tick()
    return () => clearInterval(timer)
}
