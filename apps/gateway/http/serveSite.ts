import fs from "node:fs"
import path from "node:path"
import express, { type Express, type Request, type Response, type NextFunction } from "express"

export function getSitePublicPath(): string {
    const raw = process.env.SITE_PUBLIC_PATH?.trim() || "/playtime"
    const s = raw.replace(/\/$/, "")
    return s.startsWith("/") ? s : `/${s}`
}

function candidateDirs(): string[] {
    const list: string[] = []
    const custom = process.env.SITE_DIST_PATH?.trim()
    if (custom) list.push(path.resolve(custom))
    const cwd = process.env.PLAYTIME_BACKEND_ROOT || process.cwd()
    list.push(path.resolve(cwd, "apps", "site", "dist"))
    list.push(path.resolve(cwd, "..", "apps", "site", "dist"))
    list.push(path.resolve(cwd, "site", "dist"))
    return list
}

export function resolveSiteDistDir(): string | null {
    for (const dir of candidateDirs()) {
        if (fs.existsSync(path.join(dir, "index.html"))) return dir
    }
    return null
}

export function resolveWebDistDir(siteDistDir = resolveSiteDistDir()): string | null {
    const custom = process.env.WEB_DIST_PATH?.trim()
    const cwd = process.env.PLAYTIME_BACKEND_ROOT || process.cwd()
    const candidates = custom
        ? [path.resolve(custom)]
        : [
              ...(siteDistDir ? [path.join(siteDistDir, "app")] : []),
              path.resolve(cwd, "..", "web-dist"),
              path.resolve(cwd, "web-dist")
          ]
    return candidates.find((dir) => fs.existsSync(path.join(dir, "index.html"))) ?? null
}

const webContentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    "media-src 'self' blob: data:",
    "connect-src 'self' https: wss: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'"
].join("; ")

export function attachWebApp(app: Express, siteDistDir = resolveSiteDistDir()): boolean {
    const distDir = resolveWebDistDir(siteDistDir)
    const webBase = `${getSitePublicPath()}/app`

    app.use(webBase, (req: Request, res: Response, next: NextFunction) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next()
        if (!distDir) return res.status(503).type("text").send("Веб-версия временно недоступна. Попробуйте позже.")
        if (req.path === "/" && !req.originalUrl.split("?")[0].endsWith("/")) {
            const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : ""
            return res.redirect(301, `${webBase}/${query}`)
        }
        res.setHeader("Content-Security-Policy", webContentSecurityPolicy)
        if (req.path === "/" || req.path === "/index.html") res.setHeader("Cache-Control", "no-cache")
        next()
    })

    if (!distDir) return false
    app.use(
        webBase,
        express.static(distDir, {
            index: "index.html",
            redirect: false,
            maxAge: process.env.NODE_ENV === "production" ? "1d" : 0,
            setHeaders(res, file) {
                if (path.basename(file) === "index.html") res.setHeader("Cache-Control", "no-cache")
            }
        }),
        (_req: Request, res: Response) => {
            res.status(404).type("text").send("Файл не найден")
        }
    )
    console.log("[web] приложение:", distDir, "→", `${webBase}/`)
    return true
}

export function isPlaytimeApiPath(urlPath: string): boolean {
    if (urlPath.startsWith("/playtime/auth")) return true
    if (urlPath.startsWith("/playtime/subscription")) return true
    if (urlPath.startsWith("/playtime/billing")) return true
    if (urlPath.startsWith("/playtime/feedback-api")) return true
    if (urlPath.startsWith("/playtime/site-analytics")) return true
    if (urlPath.startsWith("/playtime/peers")) return true
    if (urlPath.startsWith("/playtime/attachments")) return true
    if (urlPath.startsWith("/playtime/voice")) return true
    if (urlPath.startsWith("/playtime/releases")) return true
    if (urlPath.startsWith("/playtime/downloads")) return true
    if (
        /^\/playtime\/admin\/(session|access|me|stats|audit|health|reports|tickets|visits|users(?:\/|$)|releases(?:\/|$))/.test(
            urlPath
        )
    )
        return true
    return false
}

export function attachMarketingSite(app: Express): boolean {
    const distDir = resolveSiteDistDir()
    attachWebApp(app, distDir)
    if (!distDir) {
        console.warn("[site] dist не найден — лендинг не раздаётся (соберите apps/site/ или задайте SITE_DIST_PATH)")
        return false
    }

    const siteBase = getSitePublicPath()
    const staticOpts = {
        index: false as const,
        redirect: false,
        maxAge: process.env.NODE_ENV === "production" ? "1d" : 0
    }

    app.use(
        siteBase,
        (req: Request, res: Response, next: NextFunction) => {
            if (
                (req.method === "GET" || req.method === "HEAD") &&
                req.path === "/" &&
                !req.originalUrl.split("?")[0].endsWith("/")
            ) {
                return res.redirect(301, `${siteBase}/`)
            }
            next()
        },
        express.static(distDir, staticOpts),
        (req: Request, res: Response, next: NextFunction) => {
            if (req.method !== "GET" && req.method !== "HEAD") return next()
            if (isPlaytimeApiPath(req.originalUrl.split("?")[0])) return next()
            res.sendFile(path.join(distDir, "index.html"), (err) => {
                if (err) next(err)
            })
        }
    )

    app.get("/", (_req, res) => {
        res.redirect(301, `${siteBase}/`)
    })

    console.log("[site] лендинг:", distDir, "→", `${siteBase}/`)
    return true
}
