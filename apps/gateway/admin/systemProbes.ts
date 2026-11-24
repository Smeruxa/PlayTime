import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import type { Pool } from "pg"
import { getReleasesRoot } from "../releases/releaseService"

const execFileAsync = promisify(execFile)
const PROBE_TIMEOUT_MS = 5000
const PM2_APP_NAME = process.env.PM2_APP_NAME ?? "playtime"
const NGINX_HOST = process.env.PLAYTIME_PUBLIC_HOST ?? "smeruxa.ru"

export type ProbeBase = {
    available: boolean
    ok: boolean
    status: string
    detail: string | null
}

export type Pm2Probe = ProbeBase & {
    name: string
    restarts: number | null
    cpuPercent: number | null
    memoryMb: number | null
    pmUptimeSec: number | null
}

export type NginxProbe = ProbeBase & {
    configOk: boolean | null
    proxyOk: boolean | null
    proxyStatusCode: number | null
    proxyLatencyMs: number | null
}

export type DiskProbe = ProbeBase & {
    path: string
    freeGb: number | null
    totalGb: number | null
    usedPercent: number | null
}

export type MigrationsProbe = ProbeBase & {
    applied: number | null
    pending: number | null
    latestApplied: string | null
    latestPending: string | null
}

type Pm2JsonRow = {
    name?: string
    pm2_env?: {
        status?: string
        restart_time?: number
        pm_uptime?: number
    }
    monit?: {
        cpu?: number
        memory?: number
    }
}

async function runCommand(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string } | null> {
    try {
        const { stdout, stderr } = await execFileAsync(cmd, args, {
            timeout: PROBE_TIMEOUT_MS,
            maxBuffer: 2 * 1024 * 1024,
            env: process.env
        })
        return { stdout: stdout.trim(), stderr: stderr.trim() }
    } catch {
        return null
    }
}

export async function probePm2(appName = PM2_APP_NAME): Promise<Pm2Probe> {
    const base: Pm2Probe = {
        available: false,
        ok: true,
        status: "skipped",
        detail: null,
        name: appName,
        restarts: null,
        cpuPercent: null,
        memoryMb: null,
        pmUptimeSec: null
    }

    if (process.env.PLAYTIME_SERVICE_MANAGER === "systemd") {
        const unit = await runCommand("systemctl", ["show", "playtime", "--property=ActiveState,SubState,NRestarts,MemoryCurrent"])
        if (!unit) return { ...base, detail: "Не удалось проверить systemd" }
        const values = Object.fromEntries(unit.stdout.split("\n").map(line => line.split("=")))
        return { ...base, available: true, name: "playtime.service", ok: values.ActiveState === "active", status: values.SubState || values.ActiveState, restarts: Number(values.NRestarts) || 0, memoryMb: Number(values.MemoryCurrent) > 0 ? Math.round(Number(values.MemoryCurrent) / 1024 ** 2) : null }
    }
    const out = await runCommand("pm2", ["jlist"])
    if (!out) {
        return { ...base, detail: "pm2 недоступен (локальная разработка?)" }
    }

    let list: Pm2JsonRow[]
    try {
        list = JSON.parse(out.stdout) as Pm2JsonRow[]
    } catch {
        return {
            ...base,
            available: true,
            ok: false,
            status: "error",
            detail: "Не удалось разобрать вывод pm2 jlist"
        }
    }

    const app = list.find((row) => row.name === appName)
    if (!app) {
        return {
            ...base,
            available: true,
            ok: false,
            status: "missing",
            detail: `Процесс ${appName} не найден в pm2`
        }
    }

    const status = app.pm2_env?.status ?? "unknown"
    const pmUptime = app.pm2_env?.pm_uptime
    return {
        available: true,
        ok: status === "online",
        status,
        detail: status === "online" ? null : `pm2 status: ${status}`,
        name: appName,
        restarts: app.pm2_env?.restart_time ?? null,
        cpuPercent: typeof app.monit?.cpu === "number" ? Math.round(app.monit.cpu * 10) / 10 : null,
        memoryMb:
            typeof app.monit?.memory === "number"
                ? Math.round((app.monit.memory / (1024 * 1024)) * 10) / 10
                : null,
        pmUptimeSec: pmUptime ? Math.floor((Date.now() - pmUptime) / 1000) : null
    }
}

export async function probeNginx(): Promise<NginxProbe> {
    const base: NginxProbe = {
        available: false,
        ok: true,
        status: "skipped",
        detail: null,
        configOk: null,
        proxyOk: null,
        proxyStatusCode: null,
        proxyLatencyMs: null
    }

    const active = await runCommand("systemctl", ["is-active", "nginx"])
    if (!active) {
        return { ...base, detail: "systemctl недоступен (не Linux или nginx не через systemd)" }
    }

    const activeState = active.stdout.split("\n")[0]?.trim() || "unknown"
    const serviceOk = activeState === "active"

    const config = await runCommand("nginx", ["-t"])
    const configOk = config == null ? null : /syntax is ok/i.test(`${config.stdout}\n${config.stderr}`)
    const configFailed = config != null && !configOk

    let proxyOk: boolean | null = null
    let proxyStatusCode: number | null = null
    let proxyLatencyMs: number | null = null

    if (serviceOk) {
        const start = Date.now()
        try {
            const res = await fetch(`http://127.0.0.1/playtime/`, {
                headers: { Host: NGINX_HOST },
                redirect: "manual",
                signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
            })
            proxyLatencyMs = Date.now() - start
            proxyStatusCode = res.status
            proxyOk = res.status >= 200 && res.status < 400
        } catch {
            proxyOk = false
            proxyLatencyMs = Date.now() - start
        }
    }

    const ok = serviceOk && configOk !== false && proxyOk !== false
    let detail: string | null = null
    if (!serviceOk) detail = `systemctl: ${activeState}`
    else if (configFailed) detail = "nginx -t: ошибка конфигурации"
    else if (proxyOk === false) detail = `Прокси /playtime/ не отвечает (${proxyStatusCode ?? "timeout"})`

    return {
        available: true,
        ok,
        status: serviceOk ? "active" : activeState,
        detail,
        configOk: config == null ? null : configOk,
        proxyOk,
        proxyStatusCode,
        proxyLatencyMs
    }
}

export function probeDisk(targetPath = getReleasesRoot()): DiskProbe {
    const base: DiskProbe = {
        available: false,
        ok: true,
        status: "skipped",
        detail: null,
        path: targetPath,
        freeGb: null,
        totalGb: null,
        usedPercent: null
    }

    try {
        if (!fs.existsSync(targetPath)) {
            return {
                ...base,
                available: true,
                ok: false,
                status: "missing",
                detail: "Каталог не существует"
            }
        }

        const stats = fs.statfsSync(targetPath)
        const totalBytes = stats.blocks * stats.bsize
        const freeBytes = stats.bfree * stats.bsize
        const freeGb = Math.round((freeBytes / (1024 ** 3)) * 10) / 10
        const totalGb = Math.round((totalBytes / (1024 ** 3)) * 10) / 10
        const usedPercent =
            stats.blocks > 0 ? Math.round(((stats.blocks - stats.bfree) / stats.blocks) * 100) : null
        const ok = usedPercent == null || usedPercent < 95

        return {
            available: true,
            ok,
            status: ok ? "ok" : "low",
            detail: ok ? null : "Меньше 5% свободного места",
            path: targetPath,
            freeGb,
            totalGb,
            usedPercent
        }
    } catch {
        return { ...base, detail: "statfs недоступен" }
    }
}

export async function probeMigrations(pool: Pool, migrationsDir: string): Promise<MigrationsProbe> {
    const base: MigrationsProbe = {
        available: false,
        ok: true,
        status: "skipped",
        detail: null,
        applied: null,
        pending: null,
        latestApplied: null,
        latestPending: null
    }

    let files: string[]
    try {
        files = fs
            .readdirSync(migrationsDir)
            .filter((name) => name.endsWith(".sql"))
            .sort()
    } catch {
        return { ...base, detail: "Каталог migrations не найден" }
    }

    try {
        const { rows } = await pool.query<{ version: string }>(
            "SELECT version FROM schema_migrations ORDER BY version"
        )
        const appliedSet = new Set(rows.map((r) => r.version))
        const pending = files.filter((f) => !appliedSet.has(f))
        const ok = pending.length === 0

        return {
            available: true,
            ok,
            status: ok ? "ok" : "pending",
            detail: ok ? null : `Не применено миграций: ${pending.length}`,
            applied: rows.length,
            pending: pending.length,
            latestApplied: rows.length > 0 ? rows[rows.length - 1]!.version : null,
            latestPending: pending[0] ?? null
        }
    } catch {
        return {
            ...base,
            available: true,
            ok: false,
            status: "error",
            detail: "Не удалось прочитать schema_migrations"
        }
    }
}

export function resolveMigrationsDir(): string {
    return path.resolve(__dirname, "../../database/migrations")
}
