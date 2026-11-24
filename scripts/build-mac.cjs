const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { execFileSync } = require("node:child_process")

if (process.platform !== "darwin") throw new Error("Build macOS releases on macOS")
const root = path.resolve(__dirname, "..")
const output = fs.mkdtempSync(path.join(os.tmpdir(), "playtime-mac-"))
try {
    execFileSync(
        process.execPath,
        [
            require.resolve("electron-builder/cli.js"),
            "--mac",
            "dmg:arm64",
            "zip:arm64",
            "--publish",
            "never",
            `--config.directories.output=${output}`
        ],
        { cwd: root, stdio: "inherit" }
    )
    const dist = path.join(root, "dist")
    fs.mkdirSync(dist, { recursive: true })
    for (const entry of fs.readdirSync(output, { withFileTypes: true })) {
        if (entry.isFile()) fs.copyFileSync(path.join(output, entry.name), path.join(dist, entry.name))
    }
} finally {
    fs.rmSync(output, { recursive: true, force: true })
}
