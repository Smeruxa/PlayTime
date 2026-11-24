import { cleanupSiteVisitSessions } from "./analytics/siteVisits"
import { setBillingGrantListener } from "./billing/runtime"
import { startBillingWorker } from "./billing/worker"
import { startPushWorker } from "./push/startPushWorker"
import type { CallPushPolicy } from "./push/repository"
import { pruneOldReleases } from "./releases/retention"
import { getLimitsForUser } from "./subscription/subscriptionService"
import type { PlanSlug } from "../shared/subscription/planCatalog"

export type PublishSubscriptionPlan = (userId: number, planSlug: PlanSlug) => void

function runPeriodically(label: string, interval: number, work: () => Promise<unknown>): () => void {
    let running = false
    function tick() {
        if (running) return
        running = true
        void work()
            .catch((error) => console.error(label, error))
            .finally(() => {
                running = false
            })
    }
    tick()
    const timer = setInterval(tick, interval).unref()
    return () => clearInterval(timer)
}

export function startGatewayJobs(
    publishPlan: PublishSubscriptionPlan,
    allowsRingingPush: CallPushPolicy,
    ownsJobs = true
): () => void {
    setBillingGrantListener(async (userId) => {
        const { planSlug } = await getLimitsForUser(userId)
        publishPlan(userId, planSlug)
    })
    if (!ownsJobs) return () => {}
    const stopPruning = runPeriodically("release retention", 86400000, pruneOldReleases)
    const stopVisits = runPeriodically("site visit cleanup", 5 * 60 * 1000, cleanupSiteVisitSessions)
    const stopPush = startPushWorker(allowsRingingPush)
    const stopBilling = startBillingWorker()
    return () => {
        stopPruning()
        stopVisits()
        stopPush?.()
        stopBilling?.()
    }
}
