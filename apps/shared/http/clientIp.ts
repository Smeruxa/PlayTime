import type { Request } from "express"

const DEFAULT_ADMIN_IP_WHITELIST = ["127.0.0.1", "::1"] as const

const LOCALHOST_ALIASES = new Set(["127.0.0.1", "::1", "localhost"])

const DEFAULT_TRUSTED_PROXY_IPS = new Set(["127.0.0.1", "::1"])

export function warnMissingTrustedProxyIps(): void {
    if (process.env.NODE_ENV === "production" && !process.env.TRUSTED_PROXY_IPS?.trim()) {
        console.warn("[gateway] TRUSTED_PROXY_IPS is unset. Client IP headers are accepted only from loopback.")
    }
}

function parseWhitelist(): Set<string> {
    const raw = process.env.ADMIN_IP_WHITELIST?.trim()
    const parts = raw
        ? raw
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
        : process.env.NODE_ENV === "production"
          ? []
          : [...DEFAULT_ADMIN_IP_WHITELIST]
    const set = new Set<string>()
    for (const entry of parts) {
        const normalized = normalizeIp(entry)
        if (normalized) set.add(normalized)
        if (LOCALHOST_ALIASES.has(entry.toLowerCase()) || entry === "localhost") {
            set.add("127.0.0.1")
            set.add("::1")
        }
    }
    return set
}

let cachedWhitelist: Set<string> | null = null

function getWhitelist(): Set<string> {
    if (!cachedWhitelist) cachedWhitelist = parseWhitelist()
    return cachedWhitelist
}

let cachedTrustedProxies: Set<string> | null = null

function getTrustedProxyIps(): Set<string> {
    if (cachedTrustedProxies) return cachedTrustedProxies
    const raw = process.env.TRUSTED_PROXY_IPS?.trim()
    if (!raw) {
        cachedTrustedProxies = DEFAULT_TRUSTED_PROXY_IPS
        return cachedTrustedProxies
    }
    const set = new Set<string>()
    for (const part of raw.split(",")) {
        const ip = normalizeIp(part.trim())
        if (ip) set.add(ip)
    }
    cachedTrustedProxies = set.size > 0 ? set : DEFAULT_TRUSTED_PROXY_IPS
    return cachedTrustedProxies
}

export function normalizeIp(ip: string | undefined | null): string {
    if (!ip) return ""
    let s = ip.trim()
    if (s.startsWith("::ffff:")) s = s.slice("::ffff:".length)
    if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1)
    return s
}

function isTrustedProxyHop(ip: string): boolean {
    if (!ip) return false
    const trusted = getTrustedProxyIps()
    if (trusted.has(ip)) return true
    if (LOCALHOST_ALIASES.has(ip)) {
        return trusted.has("127.0.0.1") || trusted.has("::1")
    }
    return false
}

export function resolveClientIp(req: Request): string {
    const remote = normalizeIp(req.socket.remoteAddress)

    if (isTrustedProxyHop(remote)) {
        const xReal = req.headers["x-real-ip"]
        if (typeof xReal === "string" && xReal.trim()) {
            const fromProxy = normalizeIp(xReal)
            if (fromProxy) return fromProxy
        }
        return remote
    }

    return remote
}

export function isAdminIpAllowed(req: Request): boolean {
    const whitelist = getWhitelist()
    const clientIp = resolveClientIp(req)
    if (!clientIp) return false

    if (whitelist.has(clientIp)) return true
    if (LOCALHOST_ALIASES.has(clientIp)) {
        return whitelist.has("127.0.0.1") || whitelist.has("::1") || whitelist.has("localhost")
    }
    return false
}
