import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const workspaceRoot = path.resolve(__dirname, "../..")
const repositoryRoot = path.dirname(workspaceRoot)
const siteDir = path.join(workspaceRoot, "site")
const distIndex = path.join(siteDir, "dist", "index.html")
const hasWebBuild = fs.existsSync(path.join(repositoryRoot, "vite.web.config.mts"))

export function ensureSiteBuild(): void {
    if (process.env.SKIP_SITE_BUILD === "1") {
        console.log("[site] SKIP_SITE_BUILD=1 — сборка пропущена")
        return
    }
    if (!fs.existsSync(path.join(siteDir, "package.json"))) {
        console.warn("[site] каталог apps/site/ не найден — сборка пропущена")
        return
    }
    if (fs.existsSync(distIndex) && (!hasWebBuild || fs.existsSync(path.join(siteDir, "dist", "app", "index.html"))) && process.env.SITE_REBUILD !== "1") {
        console.log("[site] dist уже есть (SITE_REBUILD=1 для принудительной пересборки)")
        return
    }
    console.log(hasWebBuild ? "[site] npm run build:web-site…" : "[site] npm run build в apps/site/…")
    const r = spawnSync("npm", ["run", hasWebBuild ? "build:web-site" : "build"], {
        cwd: hasWebBuild ? repositoryRoot : siteDir,
        stdio: "inherit",
        shell: process.platform === "win32"
    })
    if (r.status !== 0) {
        throw new Error("site build failed")
    }
    if (!fs.existsSync(distIndex)) {
        throw new Error("site build finished but dist/index.html is missing")
    }
    console.log("[site] сборка готова")
}

if (process.argv[1]?.endsWith("ensureSiteBuild.ts")) {
    ensureSiteBuild()
}
