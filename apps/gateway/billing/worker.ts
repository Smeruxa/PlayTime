import { billingService } from "./runtime"
import { readBillingConfig } from "./config"
import type { BillingService } from "./orderService"

export function startBillingWorker(service: BillingService = billingService): (() => void) | null {
    if (!readBillingConfig()) return null
    let running = false
    let stopped = false
    const tick = async () => {
        if (running || stopped) return
        running = true
        try {
            await service.tick()
        } catch {
            console.error("Billing reconciliation temporarily unavailable")
        } finally {
            running = false
        }
    }
    const timer = setInterval(() => {
        void tick()
    }, 5000)
    timer.unref()
    void tick()
    return () => {
        stopped = true
        clearInterval(timer)
    }
}
