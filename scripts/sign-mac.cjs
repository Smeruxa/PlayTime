const fs = require("node:fs")
const path = require("node:path")
const { createRequire } = require("node:module")
const { execFileSync } = require("node:child_process")

const builderRequire = createRequire(
    require.resolve("app-builder-lib", { paths: [require.resolve("electron-builder")] })
)
const { signAsync } = builderRequire("@electron/osx-sign")
const asar = builderRequire("@electron/asar")

module.exports = async function signMac(options) {
    const archive = path.join(options.app, "Contents/Resources/app.asar")
    const pkg = JSON.parse(asar.extractFile(archive, "package.json").toString())
    if (pkg.main !== "apps/frontend/public/electron.js") throw new Error(`Unexpected packaged entry point: ${pkg.main}`)
    const required = ["build/index.html", "apps/frontend/public/electron.js", "apps/frontend/public/preload.js"]
    for (const name of fs.readdirSync(path.join(__dirname, "../apps/frontend/public/electron"))) {
        if (name.endsWith(".js")) required.push(`apps/frontend/public/electron/${name}`)
    }
    for (const file of required) {
        if (!asar.extractFile(archive, file).length) throw new Error(`Missing packaged file: ${file}`)
    }

    const adHoc = !options.identity || options.identity === "-"
    await signAsync({
        ...options,
        identity: options.identity || "-",
        identityValidation: false,
        gatekeeperAssess: false,
        preAutoEntitlements: !adHoc,
        optionsForFile: (file) => ({
            ...options.optionsForFile(file),
            ...(adHoc ? { hardenedRuntime: false, timestamp: "none" } : {})
        })
    })
    execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", options.app], { stdio: "inherit" })
    console.log(
        adHoc
            ? "✓ Valid ad-hoc macOS signature (manual first-launch approval required)"
            : "✓ Valid Developer ID signature"
    )
}
