import { pool, redis } from "../../shared/config"
import { internalHeader, internalSecret } from "../../shared/runtime/internalHttp"

const PROBE_INTERVAL_MS = 1000
const MAX_RESULT_AGE_MS = 2500

async function serviceReady(origin: URL): Promise<boolean> {
    const response = await fetch(new URL("/internal/health", origin), {
        headers: { [internalHeader]: internalSecret() },
        redirect: "error",
        signal: AbortSignal.timeout(PROBE_INTERVAL_MS)
    })
    await response.body?.cancel()
    return response.ok
}

export function monitorHttpDependencies(auth: URL, chat: URL) {
    let available = false
    let checkedAt = 0
    let pending = false

    async function check(): Promise<void> {
        if (pending) return
        pending = true
        try {
            if (redis.status !== "ready") {
                available = false
                return
            }
            const results = await Promise.allSettled([
                serviceReady(auth),
                serviceReady(chat),
                pool.query("SELECT 1"),
                redis.ping()
            ] as const)
            const [authResult, chatResult, databaseResult, redisResult] = results
            available =
                authResult.status === "fulfilled" && authResult.value &&
                chatResult.status === "fulfilled" && chatResult.value &&
                databaseResult.status === "fulfilled" &&
                redisResult.status === "fulfilled" && redisResult.value === "PONG"
        } finally {
            pending = false
            checkedAt = Date.now()
        }
    }

    void check()
    const timer = setInterval(() => void check(), PROBE_INTERVAL_MS).unref()
    return {
        available: () => available && Date.now() - checkedAt <= MAX_RESULT_AGE_MS,
        stop: () => clearInterval(timer)
    }
}
