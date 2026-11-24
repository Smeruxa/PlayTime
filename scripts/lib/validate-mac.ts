import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { execFileSync } from "node:child_process"

export function validateMacArtifacts(dmg: string, zip: string, version: string): void {
    if (process.platform !== "darwin") throw new Error("Validate macOS releases on macOS before publishing")
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "playtime-verify-"))
    const mount = path.join(temp, "mount")
    fs.mkdirSync(mount)
    let mounted = false
    try {
        execFileSync("hdiutil", ["verify", dmg], { stdio: "pipe" })
        execFileSync("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, dmg], { stdio: "pipe" })
        mounted = true
        const unpacked = path.join(temp, "zip")
        execFileSync("ditto", ["-x", "-k", zip, unpacked])
        const hashes: string[] = []
        for (const dir of [mount, unpacked]) {
            const app = path.join(dir, "PlayTime.app")
            execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "pipe" })
            const actualVersion = execFileSync(
                "/usr/libexec/PlistBuddy",
                ["-c", "Print :CFBundleShortVersionString", path.join(app, "Contents/Info.plist")],
                { encoding: "utf8" }
            ).trim()
            if (actualVersion !== version) throw new Error(`Artifact version ${actualVersion} differs from ${version}`)
            const archive = fs.readFileSync(path.join(app, "Contents/Resources/app.asar"))
            hashes.push(crypto.createHash("sha512").update(archive).digest("hex"))
        }
        if (hashes[0] !== hashes[1]) throw new Error("DMG and updater ZIP contain different applications")
        console.log("✓ DMG and updater ZIP: valid signatures, matching version and application")
    } finally {
        if (mounted) execFileSync("hdiutil", ["detach", mount], { stdio: "pipe" })
        fs.rmSync(temp, { recursive: true, force: true })
    }
}
