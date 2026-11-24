import path from "node:path"
import type { Server } from "node:http"
import { config as dotenv } from "dotenv"
import express from "express"
import { internalSecret, isInternalRequest, type ServiceName } from "./internalHttp"

const backendRoot = path.resolve(__dirname, "../..")

export function configureServiceEnvironment(scope: ServiceName | "GATEWAY", name: string): void {
    if (!process.env.PLAYTIME_SKIP_DOTENV) {
        dotenv({ path: process.env.DOTENV_CONFIG_PATH || path.join(process.cwd(), ".env"), quiet: true })
    }
    internalSecret()
    process.env.PLAYTIME_BACKEND_ROOT ||= backendRoot
    process.env.PG_APPLICATION_NAME ||= name
    for (const key of ["PG_USER", "PG_PASSWORD", "PG_POOL_MAX"]) {
        const scoped = process.env[`PLAYTIME_${scope}_${key}`]
        if (scoped !== undefined) process.env[key] = scoped
    }
    process.env.PG_POOL_MAX ||= "4"
    if (scope !== "GATEWAY") process.env.TRUSTED_PROXY_IPS = "127.0.0.1"
}

export function createPrivateApp(name: string) {
    const app = express()
    app.set("trust proxy", 1)
    app.use((req, res, next) => {
        if (isInternalRequest(req)) next()
        else res.sendStatus(403)
    })
    app.get("/internal/health", (_req, res) => res.json({ ok: true, service: name, pid: process.pid }))
    return app
}

export async function listenService(
    server: Server,
    name: string,
    port: number,
    host: string,
    closeClients: () => void | Promise<void>,
    shutdownTimeoutMs = 10_000
): Promise<void> {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port for ${name}`)
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject)
        server.listen(port, host, () => {
            server.off("error", reject)
            resolve()
        })
    })
    console.log(`[${name}] listening on ${host}:${port} (pid ${process.pid})`)

    let stopping = false
    const stop = () => {
        if (stopping) return
        stopping = true
        const deadline = setTimeout(() => process.exit(0), shutdownTimeoutMs)
        deadline.unref()
        const drained = new Promise<void>((resolve) => server.close(() => resolve()))
        const closed = Promise.resolve().then(closeClients)
        void Promise.allSettled([drained, closed]).then(() => process.exit(0))
    }
    process.once("SIGTERM", stop)
    process.once("SIGINT", stop)
}

export function runService(main: () => Promise<void>): void {
    process.once("unhandledRejection", (reason: unknown) => {
        console.error("PlayTime unhandled rejection", reason instanceof Error ? reason.name : typeof reason)
        process.exit(1)
    })
    void main().catch((error) => {
        console.error("PlayTime service failed to start", error)
        process.exit(1)
    })
}
