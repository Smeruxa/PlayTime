import "dotenv/config"
import { spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { configuredServicePort, internalHeader, type ServiceName } from "./internalHttp"

const serviceNames = { AUTH: "auth-api", CHAT: "chat-api", ROOM: "room-api" } as const
const scopes = ["AUTH", "CHAT", "ROOM", "GATEWAY"] as const
const workspaceRoot = path.resolve(__dirname, "../..")
const loader = path.join(workspaceRoot, "node_modules/tsx/dist/loader.mjs")
const children = new Set<ChildProcess>()
const secret = process.env.PLAYTIME_INTERNAL_SECRET || randomBytes(32).toString("hex")
const moderatorCredential = process.env.PLAYTIME_MODERATION_SECRET || randomBytes(32).toString("hex")
const adminSigningKey = process.env.ADMIN_SESSION_SIGNING_KEY || randomBytes(32).toString("hex")
const relayCredentials = Object.fromEntries(Object.keys(serviceNames).map((service) => {
    const key = `PLAYTIME_${service}_RELAY_SECRET`
    return [key, process.env[key] || randomBytes(32).toString("hex")]
}))
let stopping = false
let gatewayLaunched = false

function stop(code: number) {
    if (stopping) return
    stopping = true
    process.exitCode = code
    for (const child of children) child.kill("SIGTERM")
    setTimeout(() => {
        for (const child of children) child.kill("SIGKILL")
    }, 3000).unref()
}

function launch(args: string[], env: typeof process.env, cwd = workspaceRoot): ChildProcess {
    const child = spawn(process.execPath, ["--import", loader, ...args], {
        cwd,
        env,
        stdio: "inherit"
    })
    children.add(child)
    child.once("exit", () => children.delete(child))
    return child
}

function launchService(name: string, scope: (typeof scopes)[number]) {
    const env: typeof process.env = {
        ...process.env,
        PLAYTIME_INTERNAL_SECRET: secret,
        PLAYTIME_SKIP_DOTENV: "1",
        LISTEN_HOST: "127.0.0.1"
    }
    if (scope === "AUTH" || scope === "GATEWAY") env.PLAYTIME_MODERATION_SECRET = moderatorCredential
    else delete env.PLAYTIME_MODERATION_SECRET
    for (const [key, credential] of Object.entries(relayCredentials)) {
        if (scope === "GATEWAY" || key === `PLAYTIME_${scope}_RELAY_SECRET`) env[key] = credential
        else delete env[key]
    }
    if (scope === "GATEWAY") env.ADMIN_SESSION_SIGNING_KEY = adminSigningKey
    else {
        delete env.ADMIN_SESSION_SIGNING_KEY
        delete env.ADMIN_REDIS_URL
        delete env.ADMIN_ACCESS_KEY_HASH
    }
    for (const key of ["PG_USER", "PG_PASSWORD", "PG_POOL_MAX"] as const) {
        const scoped = process.env[`PLAYTIME_${scope}_${key}`]
        if (scoped !== undefined) env[key] = scoped
        for (const service of scopes) delete env[`PLAYTIME_${service}_${key}`]
    }
    const child = launch(["main.ts"], env, path.join(workspaceRoot, name))
    const fatal = () => scope === "GATEWAY" || !gatewayLaunched
    child.once("error", (error) => {
        console.error(`[${name}] launch failed`, error)
        if (fatal()) stop(1)
    })
    child.once("exit", (code, signal) => {
        if (stopping) return
        console.error(`[${name}] exited`, code ?? signal)
        if (fatal()) stop(1)
    })
}

async function ready(service: ServiceName): Promise<void> {
    const url = new URL(`http://127.0.0.1:${configuredServicePort(service)}/internal/health`)
    for (let attempt = 0; attempt < 120 && !stopping; attempt += 1) {
        const response = await fetch(url, {
            headers: { [internalHeader]: secret },
            signal: AbortSignal.timeout(500)
        }).catch(() => undefined)
        if (response?.ok) {
            const health: unknown = await response.json().catch(() => undefined)
            if (health && typeof health === "object" && "service" in health && health.service === serviceNames[service])
                return
        }
        await sleep(200)
    }
    throw new Error(`${serviceNames[service]} is unavailable`)
}

async function main() {
    const services = Object.keys(serviceNames) as ServiceName[]
    if (services.some((service) => process.env[`PLAYTIME_${service}_URL`]?.trim()))
        throw new Error("Run individual services when using PLAYTIME_*_URL")
    const ports = [Number(process.env.PORT || 1501), ...services.map(configuredServicePort)]
    if (new Set(ports).size !== ports.length) throw new Error("Gateway and service ports must be distinct")

    if (!process.env.SKIP_DB_MIGRATIONS?.trim()) {
        const migrate = launch(["database/runMigrations.ts"], process.env)
        await new Promise<void>((resolve, reject) => {
            migrate.once("error", reject)
            migrate.once("exit", (code) => (code === 0 ? resolve() : reject(new Error("Migrations failed"))))
        })
    }
    if (stopping) return
    for (const service of services) launchService(serviceNames[service], service)
    await Promise.all(services.map(ready))
    if (!stopping) {
        gatewayLaunched = true
        launchService("gateway", "GATEWAY")
    }
}

process.once("SIGINT", () => stop(0))
process.once("SIGTERM", () => stop(0))
void main().catch((error) => {
    if (stopping) return
    console.error("PlayTime service stack failed to start", error)
    stop(1)
})
