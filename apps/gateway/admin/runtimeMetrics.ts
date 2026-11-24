import { monitorEventLoopDelay } from "node:perf_hooks"
import type { RequestHandler } from "express"
const delay = monitorEventLoopDelay({ resolution: 20 })
delay.enable()
const buckets = new Map<number, { durations: number[]; requests: number; errors: number }>()
export const recordRequestMetrics: RequestHandler = (_req, res, next) => {
    const started = performance.now()
    res.once("finish", () => {
        const second = Math.floor(Date.now() / 10000),
            bucket = buckets.get(second) || { durations: [], requests: 0, errors: 0 }
        bucket.requests++
        if (res.statusCode >= 500) bucket.errors++
        if (bucket.durations.length < 5000) bucket.durations.push(performance.now() - started)
        buckets.set(second, bucket)
        for (const key of buckets.keys()) if (key < second - 5) buckets.delete(key)
    })
    next()
}
export function getRuntimeMetrics() {
    const second = Math.floor(Date.now() / 10000),
        recent = [...buckets].filter(([key]) => key >= second - 5).map(([, bucket]) => bucket),
        samples = recent.flatMap((b) => b.durations).sort((a, b) => a - b)
    return {
        requestsLastMinute: recent.reduce((n, b) => n + b.requests, 0),
        errorsLastMinute: recent.reduce((n, b) => n + b.errors, 0),
        requestP95Ms: samples.length ? Math.round(samples[Math.ceil(samples.length * 0.95) - 1]) : null,
        eventLoopP95Ms: Math.round(delay.percentile(95) / 1e6)
    }
}
