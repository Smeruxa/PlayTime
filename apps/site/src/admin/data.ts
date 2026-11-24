export type Probe = { available: boolean; ok: boolean; status: string; detail: string | null }
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
    metrics?: {
        requestsLastMinute: number
        errorsLastMinute: number
        requestP95Ms: number | null
        eventLoopP95Ms: number
        dbPool: { total: number; idle: number; waiting: number }
        redis: { usedMb: number; limitMb: number; evictedKeys: number } | null
    }
    recoveryMailConfigured?: boolean
    pm2: Probe & {
        name: string
        restarts: number | null
        cpuPercent: number | null
        memoryMb: number | null
        pmUptimeSec: number | null
    }
    nginx: Probe & {
        configOk: boolean | null
        proxyOk: boolean | null
        proxyStatusCode: number | null
        proxyLatencyMs: number | null
    }
    disk: Probe & {
        path: string
        freeGb: number | null
        totalGb: number | null
        usedPercent: number | null
    }
    migrations: Probe & {
        applied: number | null
        pending: number | null
        latestApplied: string | null
        latestPending: string | null
    }
}
export type AuditEntry = {
    id: number
    action: string
    adminUserId: number | null
    adminUsername: string | null
    targetUserId: number | null
    targetUsername: string | null
    details: Record<string, unknown>
    createdAt: string
}
const labels: Record<string, string> = {
    "ticket.update": "Обработка тикета",
    "report.resolve": "Рассмотрение жалобы",
    "subscription.change": "Смена тарифа",
    "user.block": "Блокировка",
    "user.unblock": "Снятие блокировки",
    "release.publish": "Публикация релиза",
    "release.unpublish": "Снятие релиза",
    "release.latest": "Смена текущей версии",
    "release.notes": "Правка описания",
}
export const actionLabel = (action: string) => labels[action] ?? action
export function auditDetails(entry: AuditEntry): string {
    const d = entry.details
    if (entry.action === "ticket.update")
        return `#${String(d.ticketId ?? "")} · ${String(d.status ?? "")} · ${String(d.priority ?? "")}`
    if (entry.action === "subscription.change")
        return `${String(d.from ?? "?")} → ${String(d.to ?? "?")}`
    if (entry.action.startsWith("release."))
        return `${d.platform === "darwin" ? "macOS" : d.platform === "win32" ? "Windows" : ""} ${String(d.version ?? "")}`.trim()
    return typeof d.reason === "string" ? d.reason : "—"
}
export const shortDate = (value: string) =>
    new Date(value).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    })
const adminCalendarDate = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Moscow",
})
export function formatAdminCalendarDate(value: string | null): string | null {
    if (!value) return null
    const timestamp = Date.parse(value)
    return Number.isFinite(timestamp) ? adminCalendarDate.format(timestamp) : null
}
export const uptime = (seconds: number) =>
    `${Math.floor(seconds / 3600)} ч ${Math.floor((seconds % 3600) / 60)} мин`
