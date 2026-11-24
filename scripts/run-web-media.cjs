const { spawn, execFile } = require("node:child_process")
const { promisify } = require("node:util")
const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const crypto = require("node:crypto")
const root = path.resolve(__dirname, "..")
const stop = new AbortController()
process.once("SIGINT", () => stop.abort())
process.once("SIGTERM", () => stop.abort())
function run(file, env) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(root, "scripts/tests", file)], {
            cwd: root, env: { ...process.env, ...env }, stdio: "inherit", signal: stop.signal
        })
        child.once("error", reject)
        child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${file} exited with code ${code}`)))
    })
}
;(async () => {
    if (process.env.WEB_MEDIA_ICE_CONFIG_FILE || process.env.WEB_MEDIA_DIRECT === "1")
        return run("web-media-loopback.cjs", {})
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "playtime-media-relay-"))
    const configFile = path.join(temporary, "relay.json")
    const owner = crypto.randomBytes(16).toString("hex")
    try {
        await run("web-ice-control.cjs", { WEB_ICE_KEEP_CONFIG: configFile, WEB_ICE_OWNER: owner })
        await run("web-media-loopback.cjs", { WEB_MEDIA_ICE_CONFIG_FILE: configFile })
    } finally {
        const config = await fs.readFile(configFile, "utf8").then(JSON.parse).catch(() => null)
        if (/^[a-f0-9]{64}$/.test(config?.container || ""))
            await promisify(execFile)("docker", ["rm", "-f", config.container], { timeout: 30000 }).catch(() => {})
        const owned = await promisify(execFile)("docker", ["ps", "-aq", "--filter", `label=playtime.qa.owner=${owner}`], { timeout: 30000 }).catch(() => ({ stdout: "" }))
        for (const id of owned.stdout.trim().split(/\s+/).filter(id => /^[a-f0-9]{12,64}$/.test(id)))
            await promisify(execFile)("docker", ["rm", "-f", id], { timeout: 30000 }).catch(() => {})
        await fs.rm(temporary, { recursive: true, force: true })
    }
})().catch(error => { console.error(error.message); process.exitCode = 1 })
