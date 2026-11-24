import fs from "node:fs"
import os from "node:os"
import { getRuntimeMetrics } from "./runtimeMetrics"
import { pool, redis } from "../../shared/config"
import { getReleasesRoot } from "../releases/releaseService"
import { resolveSiteDistDir } from "../http/serveSite"
import {
    probeDisk,
    probeMigrations,
    probeNginx,
    probePm2,
    resolveMigrationsDir,
    type DiskProbe,
    type MigrationsProbe,
    type NginxProbe,
    type Pm2Probe
} from "./systemProbes"

export type AdminHealth = {
    ok: boolean
    checkedAt: string
    uptimeSec: number
    nodeVersion: string
    platform: string
    memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number }
    loadAvg: number[]
    db: boolean
    redis: boolean
    siteDist: boolean
    releasesDir: boolean
    env: string
    pm2: Pm2Probe
    nginx: NginxProbe
    disk: DiskProbe
    migrations: MigrationsProbe
    recoveryMailConfigured: boolean
    metrics: ReturnType<typeof getRuntimeMetrics> & {
        dbPool: { total: number; idle: number; waiting: number }
        redis: { usedMb: number; limitMb: number; evictedKeys: number } | null
    }
}

function mb(bytes: number) {
    return Math.round((bytes / (1024 * 1024)) * 10) / 10
}

export async function getAdminHealth(getRecoveryMailStatus: () => Promise<boolean>): Promise<AdminHealth> {
    const mem = process.memoryUsage()
    let db = false
    let redisOk = false

    try {
        await pool.query("SELECT 1")
        db = true
    } catch {
        db = false
    }

    try {
        const pong = await redis.ping()
        redisOk = pong === "PONG"
    } catch {
        redisOk = false
    }

    const siteDist = resolveSiteDistDir() != null
    let releasesDir = false
    try {
        releasesDir = fs.existsSync(getReleasesRoot())
    } catch {
        releasesDir = false
    }

    const [pm2, nginx, migrations, recoveryMailConfigured] = await Promise.all([
        probePm2(),
        probeNginx(),
        probeMigrations(pool, resolveMigrationsDir()),
        getRecoveryMailStatus().catch(() => false)
    ])
    const disk = probeDisk(getReleasesRoot())
    let redisMemory: AdminHealth["metrics"]["redis"] = null
    try {
        const info = await redis.info()
        const values = Object.fromEntries(
            info
                .split("\n")
                .filter((line) => line.includes(":"))
                .map((line) => line.trim().split(":"))
        )
        redisMemory = {
            usedMb: mb(Number(values.used_memory)),
            limitMb: mb(Number(values.maxmemory)),
            evictedKeys: Number(values.evicted_keys) || 0
        }
    } catch {}

    const infraOk = (probe: { available: boolean; ok: boolean }) => !probe.available || probe.ok
    const ok =
        db &&
        redisOk &&
        siteDist &&
        releasesDir &&
        infraOk(pm2) &&
        infraOk(nginx) &&
        infraOk(disk) &&
        infraOk(migrations)

    return {
        ok,
        checkedAt: new Date().toISOString(),
        uptimeSec: Math.floor(process.uptime()),
        nodeVersion: process.version,
        platform: `${os.platform()} ${os.arch()}`,
        memory: {
            rssMb: mb(mem.rss),
            heapUsedMb: mb(mem.heapUsed),
            heapTotalMb: mb(mem.heapTotal)
        },
        loadAvg: os.loadavg().map((n) => Math.round(n * 100) / 100),
        db,
        redis: redisOk,
        siteDist,
        releasesDir,
        env: process.env.NODE_ENV ?? "development",
        pm2,
        nginx,
        disk,
        migrations,
        recoveryMailConfigured,
        metrics: {
            ...getRuntimeMetrics(),
            dbPool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
            redis: redisMemory
        }
    }
}
