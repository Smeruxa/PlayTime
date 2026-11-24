import type { Express } from "express"

export function configureTrustProxy(app: Express): void {
    const raw = process.env.TRUST_PROXY?.trim()
    if (!raw) return
    if (raw === "1" || raw.toLowerCase() === "true") {
        app.set("trust proxy", 1)
        return
    }
    const n = parseInt(raw, 10)
    if (Number.isFinite(n) && n >= 1) {
        app.set("trust proxy", n)
    }
}

export function getCorsOrigin(): string | string[] {
    const raw = process.env.CORS_ORIGIN
    const list: string[] = []
    if (raw && raw.trim()) {
        for (const part of raw.split(",")) {
            const s = part.trim()
            if (s) list.push(s)
        }
    }
    const site = process.env.SITE_ORIGIN?.trim()
    if (site && !list.includes(site)) list.push(site)
    const prodApp = process.env.PRODUCTION_APP_ORIGIN?.trim()
    if (prodApp && !list.includes(prodApp)) list.push(prodApp)
    if (list.length > 0) {
        return list.length === 1 ? list[0] : list
    }
    if (process.env.NODE_ENV === "production") {
        if (prodApp) return prodApp
        throw new Error("CORS_ORIGIN or PRODUCTION_APP_ORIGIN must be set in production")
    }
    const siteDev = process.env.SITE_DEV_ORIGIN?.trim() || "http://localhost:5173"
    const origins = new Set<string>([
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        siteDev,
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173"
    ])
    if (siteDev.includes("://localhost:")) {
        origins.add(siteDev.replace("://localhost:", "://127.0.0.1:"))
    }
    if (siteDev.includes("://127.0.0.1:")) {
        origins.add(siteDev.replace("://127.0.0.1:", "://localhost:"))
    }
    return Array.from(origins)
}
