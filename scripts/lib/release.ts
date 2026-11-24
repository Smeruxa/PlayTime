import crypto from "node:crypto"
import fs from "node:fs"
import { devNull } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { validateMacArtifacts } from "./validate-mac"

export type Platform = "darwin" | "win32"

export function repoRoot(): string {
    return path.resolve(__dirname, "../..")
}

export function readEnvFile(filePath: string): Record<string, string> {
    if (!fs.existsSync(filePath)) return {}
    const out: Record<string, string> = {}
    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
        const t = line.trim()
        if (!t || t.startsWith("#")) continue
        const i = t.indexOf("=")
        if (i < 1) continue
        let value = t.slice(i + 1).trim()
        if (value.startsWith('"') && value.endsWith('"')) value = JSON.parse(value)
        else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1)
        out[t.slice(0, i).trim()] = value
    }
    return out
}

export function readReleaseProfile(root = repoRoot()): Record<string, string> {
    return readEnvFile(path.resolve(root, process.env.PLAYTIME_RELEASE_PROFILE || "deploy_backend/.env"))
}

export function readPackageVersion(root = repoRoot()): string {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version?: string }
    if (!pkg.version) throw new Error("package.json: version missing")
    return pkg.version
}

export function writePackageVersion(version: string, root = repoRoot()): void {
    const pkgPath = path.join(root, "package.json")
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string }
    pkg.version = version
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 4)}\n`, "utf8")
    const lockPath = path.join(root, "package-lock.json")
    if (fs.existsSync(lockPath)) {
        const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"))
        lock.version = version
        if (lock.packages?.[""]) lock.packages[""].version = version
        fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 4)}\n`, "utf8")
    }
}

export function bumpSemver(current: string, kind: "patch" | "minor" | "major"): string {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/.exec(current)
    if (!m) throw new Error(`Invalid semver: ${current}`)
    let major = Number(m[1])
    let minor = Number(m[2])
    let patch = Number(m[3])
    if (kind === "major") {
        major += 1
        minor = 0
        patch = 0
    } else if (kind === "minor") {
        minor += 1
        patch = 0
    } else {
        patch += 1
    }
    return `${major}.${minor}.${patch}`
}

function sha512Base64(filePath: string): string {
    const hash = crypto.createHash("sha512")
    hash.update(fs.readFileSync(filePath))
    return hash.digest("base64")
}

export function findArtifacts(distDir: string, platform: Platform, versionHint: string) {
    const names = fs.readdirSync(distDir)
    if (platform === "darwin") {
        const dmgs = names.filter(
            (n) => n === `PlayTime-${versionHint}-arm64.dmg` || n === `PlayTime-${versionHint}.dmg`
        )
        const dmg =
            dmgs.find((n) => n === `PlayTime-${versionHint}-arm64.dmg`) ??
            dmgs.find((n) => !n.includes("-x64") && !n.includes("-ia32")) ??
            dmgs[0]
        const zips = names.filter(
            (n) => n === `PlayTime-${versionHint}-arm64-mac.zip` || n === `PlayTime-${versionHint}-mac.zip`
        )
        const zip =
            zips.find((n) => n === `PlayTime-${versionHint}-arm64-mac.zip`) ??
            zips.find((n) => !n.includes("-x64")) ??
            zips[0] ??
            null
        if (!dmg) throw new Error(`No .dmg for ${versionHint} in dist/`)
        if (!zip) throw new Error(`No updater .zip for ${versionHint} in dist/`)
        return { primary: dmg, update: zip }
    }
    const exe = names.find((n) => n === `PlayTime-${versionHint}-Setup.exe`)
    if (!exe) throw new Error(`No Setup .exe for ${versionHint} in dist/`)
    return { primary: exe, update: null }
}

const REACT_INPUT_DIRS = ["apps/frontend/src", "apps/frontend/public"] as const

function dirHasNewerFileThan(dir: string, sinceMs: number): boolean {
    if (!fs.existsSync(dir)) return false
    const stack = [dir]
    while (stack.length > 0) {
        const current = stack.pop()!
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name)
            if (entry.isDirectory()) {
                if (entry.name === "node_modules" || entry.name === "build") continue
                stack.push(full)
                continue
            }
            if (entry.isFile() && fs.statSync(full).mtimeMs > sinceMs) return true
        }
    }
    return false
}

export function isReactBuildFresh(root = repoRoot()): boolean {
    const buildHtml = path.join(root, "build", "index.html")
    if (!fs.existsSync(buildHtml) || !fs.existsSync(path.join(root, "build", "incoming-call.html"))) return false
    const sinceMs = fs.statSync(buildHtml).mtimeMs
    const configFiles = [
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        "vite.config.mts",
        "apps/frontend/index.html",
        "apps/frontend/incoming-call.html",
        ".env",
        ".env.local",
        ".env.production",
        ".env.production.local"
    ]
    return (
        !configFiles.some(
            (file) => fs.existsSync(path.join(root, file)) && fs.statSync(path.join(root, file)).mtimeMs > sinceMs
        ) && !REACT_INPUT_DIRS.some((d) => dirHasNewerFileThan(path.join(root, d), sinceMs))
    )
}

export function runReactBuild(root = repoRoot(), options?: { force?: boolean }): void {
    if (!options?.force && isReactBuildFresh(root)) {
        console.log("→ react-build пропущен (сборка актуальна)")
        return
    }
    console.log("\n→ npm run react-build")
    const r = spawnSync("npm", ["run", "react-build"], {
        cwd: root,
        stdio: "inherit",
        shell: process.platform === "win32"
    })
    if (r.status !== 0) process.exit(r.status ?? 1)
}

export function runElectron(platform: Platform | "all", root = repoRoot()): void {
    if (platform === "all") {
        runElectron("darwin", root)
        runElectron("win32", root)
        return
    }
    const script = platform === "darwin" ? "electron:mac" : "electron:win"
    console.log(`\n→ npm run ${script}`)
    const r = spawnSync("npm", ["run", script], { cwd: root, stdio: "inherit", shell: process.platform === "win32" })
    if (r.status !== 0) process.exit(r.status ?? 1)
}

export type BuildOptions = {
    skipBuild?: boolean
    forceReactBuild?: boolean
}

export function runBuild(platform: Platform | "all", root = repoRoot(), options?: BuildOptions): void {
    if (options?.skipBuild) return
    runReactBuild(root, { force: options?.forceReactBuild })
    runElectron(platform, root)
}

export function releaseSshTarget(deployEnv: Record<string, string>, root: string) {
    const host = deployEnv.DEPLOY_HOST
    const user = deployEnv.DEPLOY_USER
    const password = deployEnv.DEPLOY_PASSWORD
    const identity = deployEnv.DEPLOY_SSH_KEY
    const knownHosts = deployEnv.DEPLOY_KNOWN_HOSTS
    if (!host || !user || (!password && !identity))
        throw new Error("DEPLOY_HOST, DEPLOY_USER and an SSH credential are required")
    if (!knownHosts) throw new Error("DEPLOY_KNOWN_HOSTS is required")
    const pinnedKeys = path.resolve(root, knownHosts)
    if (!fs.statSync(pinnedKeys, { throwIfNoEntry: false })?.isFile())
        throw new Error("DEPLOY_KNOWN_HOSTS must identify a local known_hosts file")
    const port = deployEnv.DEPLOY_PORT || "22"
    const sshOpts = [
        "-F",
        devNull,
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "GlobalKnownHostsFile=none",
        "-o",
        `UserKnownHostsFile="${pinnedKeys.replace(/[\\"]/g, "\\$&")}"`,
        "-o",
        "UpdateHostKeys=no",
        "-o",
        "ConnectTimeout=30",
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=4"
    ]
    if (identity) sshOpts.push("-i", path.resolve(root, identity), "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes")
    else sshOpts.push("-o", "PubkeyAuthentication=no", "-o", "PreferredAuthentications=password")
    return { host, user, password, identity, port, sshOpts }
}

export function publishPlatform(options: {
    platform: Platform
    version: string
    notes?: string
    root?: string
    publishLatest?: boolean
    filesOnly?: boolean
}): void {
    const root = options.root ?? repoRoot()
    const deployEnv = readReleaseProfile(root)
    const { host, user, password, identity, port, sshOpts } = releaseSshTarget(deployEnv, root)
    const remotePath = deployEnv.DEPLOY_REMOTE_PATH
    const releasesPath = deployEnv.DEPLOY_RELEASES_PATH || (remotePath && path.posix.join(remotePath, "data/releases"))
    const registerSecret = deployEnv.RELEASE_REGISTER_SECRET || deployEnv.DEPLOY_RELEASE_REGISTER_SECRET
    const siteOrigin = deployEnv.SITE_ORIGIN || "https://smeruxa.ru"

    if (!releasesPath || !path.posix.isAbsolute(releasesPath))
        throw new Error("Set an absolute DEPLOY_RELEASES_PATH or DEPLOY_REMOTE_PATH")
    if (!options.filesOnly && !registerSecret) throw new Error("deploy_backend/.env: RELEASE_REGISTER_SECRET required")

    const distDir = path.join(root, "dist")
    if (!fs.existsSync(distDir)) throw new Error("dist/ not found — run build first")

    const { primary, update } = findArtifacts(distDir, options.platform, options.version)
    if (options.platform === "win32" && !options.filesOnly && options.publishLatest !== false)
        verifyWindowsManualFeed(siteOrigin)
    const primaryPath = path.join(distDir, primary)
    const updatePath = update ? path.join(distDir, update) : null
    if (options.platform === "darwin") validateMacArtifacts(primaryPath, updatePath!, options.version)
    const remoteDir = path.posix.join(releasesPath, options.platform)

    const prefix = identity ? [] : ["sshpass", "-e"]
    const sshBase = [...prefix, "ssh", "-p", port, ...sshOpts, `${user}@${host}`]
    const scpBase = [...prefix, "scp", "-P", port, "-C", ...sshOpts]
    const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'"

    const sshEnv = password && !identity ? { ...process.env, SSHPASS: password } : process.env

    console.log(`\n→ upload ${options.platform} ${options.version} to ${host}:${remoteDir}`)
    const mkdir = spawnSync(sshBase[0], sshBase.slice(1).concat([`mkdir -p ${quote(remoteDir)}`]), {
        stdio: "inherit",
        env: sshEnv
    })
    if (mkdir.status !== 0) throw new Error("Could not create remote release directory")
    for (const file of [primary, update].filter(Boolean) as string[]) {
        const local = path.join(distDir, file)
        const remoteFile = `${remoteDir}/${file}`
        const expected = Buffer.from(sha512Base64(local), "base64").toString("hex")
        const existing = spawnSync(
            sshBase[0],
            sshBase
                .slice(1)
                .concat([
                    `test -f ${quote(remoteFile)} && printf '%s  %s\\n' ${quote(expected)} ${quote(remoteFile)} | sha512sum -c -`
                ]),
            { encoding: "utf8", env: sshEnv }
        )
        if (existing.status === 0) {
            console.log(`  ✓ ${file}: already uploaded, checksum matches`)
            continue
        }
        console.log(`  → scp ${file} (${Math.round(fs.statSync(local).size / 1024 / 1024)} MB)`)
        const temporaryFile = `${remoteFile}.upload-${crypto.randomUUID()}`
        const r = spawnSync(scpBase[0], scpBase.slice(1).concat([local, `${user}@${host}:${temporaryFile}`]), {
            stdio: "inherit",
            env: sshEnv
        })
        if (r.status !== 0) process.exit(r.status ?? 1)
        const check = spawnSync(
            sshBase[0],
            sshBase
                .slice(1)
                .concat([
                    `printf '%s  %s\\n' ${quote(expected)} ${quote(temporaryFile)} | sha512sum -c - && mv -- ${quote(temporaryFile)} ${quote(remoteFile)}`
                ]),
            { stdio: "inherit", env: sshEnv }
        )
        if (check.status !== 0) throw new Error(`Remote checksum verification failed: ${file}`)
    }

    if (options.filesOnly) return

    const payload = {
        version: options.version,
        platform: options.platform,
        filename: primary,
        updateFilename: update,
        fileSize: fs.statSync(primaryPath).size,
        updateFileSize: updatePath ? fs.statSync(updatePath).size : null,
        sha512: sha512Base64(primaryPath),
        updateSha512: updatePath ? sha512Base64(updatePath) : null,
        releaseNotes: options.notes?.trim() || null,
        publishLatest: options.publishLatest !== false
    }

    const reg = spawnSync(
        "curl",
        [
            "-sfS",
            "-X",
            "POST",
            `${siteOrigin.replace(/\/$/, "")}/playtime/admin/releases/register`,
            "-H",
            "Content-Type: application/json",
            "-H",
            "@-",
            "-d",
            JSON.stringify(payload)
        ],
        { encoding: "utf8", input: `X-Release-Register-Secret: ${registerSecret}\n` }
    )
    if (reg.status !== 0) {
        console.error(reg.stderr || reg.stdout)
        process.exit(reg.status ?? 1)
    }
    console.log(reg.stdout)
}

function verifyWindowsManualFeed(siteOrigin: string): void {
    const url = `${siteOrigin.replace(/\/$/, "")}/playtime/releases/feed/win32/latest.yml`
    const result = spawnSync("curl", ["-sS", "--max-time", "30", "-o", devNull, "-w", "%{http_code}", url], {
        encoding: "utf8"
    })
    if (result.status !== 0 || result.stdout !== "410")
        throw new Error("Windows updater feed must return HTTP 410 before publishing a manual release")
}

export function verifyFeed(platform: Platform, version: string, siteOrigin = "https://smeruxa.ru"): void {
    const baseUrl = `${siteOrigin.replace(/\/$/, "")}/playtime/releases`
    const windows = platform === "win32"
    if (windows) verifyWindowsManualFeed(siteOrigin)
    const url = windows ? `${baseUrl}/latest` : `${baseUrl}/feed/darwin/latest-mac.yml`
    const r = spawnSync("curl", ["-sfS", "--max-time", "30", url], { encoding: "utf8" })
    if (r.status !== 0) {
        throw new Error(`Feed check failed: ${url}`)
    }
    const matches = windows
        ? JSON.parse(r.stdout).releases?.win32?.version === version
        : r.stdout.split(/\r?\n/).includes(`version: ${version}`)
    if (!matches) throw new Error(`Published ${platform} version mismatch: ${version}`)
    console.log(`✓ Published ${platform}: ${version}`)
}

export function defaultPlatform(): Platform {
    return process.platform === "win32" ? "win32" : "darwin"
}

export function platformsFromArg(arg: string): Platform[] {
    if (arg === "all") return ["darwin", "win32"]
    if (arg === "darwin" || arg === "win32") return [arg]
    throw new Error("platform must be darwin, win32, or all")
}
