const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const root = path.resolve(__dirname, "..")
const siteDir = path.join(root, "apps", "site")
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
for (const [cwd, args] of [[root, ["run", "web:build"]], [siteDir, ["run", "build"]]]) {
    const result = spawnSync(npm, args, { cwd, stdio: "inherit", shell: process.platform === "win32" })
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status || 1)
}
const webDist = path.join(root, "web-dist")
if (!fs.existsSync(path.join(webDist, "index.html"))) throw new Error("Web build is missing index.html")
fs.cpSync(webDist, path.join(siteDir, "dist", "app"), { recursive: true })
console.log("Static delivery ready: apps/site/dist (landing + web app)")
