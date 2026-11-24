import fs from "node:fs"
import path from "node:path"
import { createHash, randomBytes } from "node:crypto"

type Options = { envFile: string; keyFile: string; rotate: boolean }
type ExistingFile = { contents: string; exists: boolean }
const HASH_SETTING = /^[^\S\r\n]*(?:export[^\S\r\n]+)?ADMIN_ACCESS_KEY_HASH[^\S\r\n]*=[^\r\n]*(?:\r?\n|$)/gm
const SIGNING_SETTING = /^[^\S\r\n]*(?:export[^\S\r\n]+)?ADMIN_SESSION_SIGNING_KEY[^\S\r\n]*=[^\r\n]*(?:\r?\n|$)/gm
const MAX_FILE_BYTES = 1024 * 1024

export function parseAdminAccessArgs(args: string[]): Options {
    let envFile = "",
        keyFile = "",
        rotate = false
    for (let i = 0; i < args.length; i++) {
        const option = args[i]
        if (option === "--rotate" && !rotate) {
            rotate = true
            continue
        }
        if (option !== "--env-file" && option !== "--key-file")
            throw new Error("Unknown or duplicate option. Use --help.")
        const value = args[++i]
        if (!value || value.startsWith("--")) throw new Error("Both file options require a path.")
        if (option === "--env-file") {
            if (envFile) throw new Error("Duplicate environment file option.")
            envFile = value
        } else {
            if (keyFile) throw new Error("Duplicate key file option.")
            keyFile = value
        }
    }
    if (!envFile || !keyFile) throw new Error("Provide --env-file PATH and --key-file PATH. Use --help.")
    return { envFile, keyFile, rotate }
}

function canonicalTarget(input: string): string {
    const resolved = path.resolve(input)
    return path.join(fs.realpathSync(path.dirname(resolved)), path.basename(resolved))
}

function readExisting(file: string): ExistingFile {
    let stat: fs.Stats
    try {
        stat = fs.lstatSync(file)
    } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return { contents: "", exists: false }
        throw error
    }
    if (!stat.isFile() || stat.nlink !== 1)
        throw new Error("Targets must be regular files without symlinks or hard links.")
    if (stat.size > MAX_FILE_BYTES) throw new Error("A target file is unexpectedly large; refusing to replace it.")
    const contents = fs.readFileSync(file, "utf8")
    if (contents.includes("\0")) throw new Error("A target contains binary data; refusing to replace it.")
    return { contents, exists: true }
}

function hasConfiguredHash(source: string): boolean {
    return [...source.matchAll(new RegExp(HASH_SETTING))].some(([line]) => {
        const value = line
            .slice(line.indexOf("=") + 1)
            .trim()
            .replace(/\s+#.*$/, "")
            .trim()
        return value !== "" && value !== '""' && value !== "''" && !value.startsWith("#")
    })
}

function withHash(source: string, hash: string): string {
    const newline = source.includes("\r\n") ? "\r\n" : "\n"
    const signingKey = randomBytes(32).toString("base64url")
    const rest = source.replace(new RegExp(HASH_SETTING), "").replace(new RegExp(SIGNING_SETTING), "")
    return `${rest}${rest && !rest.endsWith("\n") ? newline : ""}ADMIN_ACCESS_KEY_HASH=${hash}${newline}ADMIN_SESSION_SIGNING_KEY=${signingKey}${newline}`
}

function stagePrivateFile(file: string, contents: string): string {
    const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(8).toString("hex")}.tmp`)
    const fd = fs.openSync(temporary, "wx", 0o600)
    try {
        fs.fchmodSync(fd, 0o600)
        fs.writeFileSync(fd, contents, "utf8")
        fs.fsyncSync(fd)
    } catch (error) {
        fs.closeSync(fd)
        fs.rmSync(temporary, { force: true })
        throw error
    }
    fs.closeSync(fd)
    return temporary
}

export function configureAdminAccess(options: Options): { envFile: string; keyFile: string; rotated: boolean } {
    const envFile = canonicalTarget(options.envFile),
        keyFile = canonicalTarget(options.keyFile)
    if (envFile === keyFile) throw new Error("Environment and key files must be different files.")
    const locks: string[] = []
    const temporary: string[] = []
    try {
        for (const target of [envFile, keyFile].sort()) {
            const lock = `${target}.admin-access.lock`
            let fd: number
            try {
                fd = fs.openSync(lock, "wx", 0o600)
            } catch (error) {
                if ((error as { code?: string }).code === "EEXIST")
                    throw new Error(
                        "An admin-access configuration lock already exists. Check for another running command."
                    )
                throw error
            }
            locks.push(lock)
            fs.closeSync(fd)
        }
        const env = readExisting(envFile),
            previousKey = readExisting(keyFile)
        const configured = hasConfiguredHash(env.contents)
        if (!options.rotate && (configured || previousKey.exists))
            throw new Error("Admin access or the key file already exists. Use --rotate explicitly to replace it.")
        const key = randomBytes(32).toString("base64url")
        const hash = createHash("sha256").update(key, "utf8").digest("hex")
        const stagedEnv = stagePrivateFile(envFile, withHash(env.contents, hash))
        temporary.push(stagedEnv)
        const stagedKey = stagePrivateFile(keyFile, `${key}\n`)
        temporary.push(stagedKey)
        fs.renameSync(stagedKey, keyFile)
        try {
            fs.renameSync(stagedEnv, envFile)
        } catch (error) {
            try {
                if (previousKey.exists) {
                    const rollback = stagePrivateFile(keyFile, previousKey.contents)
                    temporary.push(rollback)
                    fs.renameSync(rollback, keyFile)
                } else {
                    fs.rmSync(keyFile, { force: true })
                }
            } catch {
                throw new Error(
                    "Environment update failed and the key file could not be restored. Do not restart the backend."
                )
            }
            throw error
        }
        return { envFile, keyFile, rotated: configured || previousKey.exists }
    } finally {
        for (const file of [...temporary, ...locks]) {
            try {
                fs.rmSync(file, { force: true })
            } catch {
            }
        }
    }
}

export function runConfigureAdminAccessCli(args = process.argv.slice(2)): void {
    try {
        if (args.includes("--help")) {
            console.log(
                "Usage: tsx apps/gateway/admin/configureAdminAccess.ts --env-file PATH --key-file PATH [--rotate]\nParent directories must exist. Key material is generated locally and never printed. Both files are written atomically with mode 0600. Existing keys require --rotate."
            )
        } else {
            const result = configureAdminAccess(parseAdminAccessArgs(args))
            console.log(
                `${result.rotated ? "Rotated" : "Generated"} the permanent admin access key.\nEnvironment file: ${result.envFile}\nPrivate key file: ${result.keyFile}\nRestart the backend to load the new hash. Key rotation invalidates existing admin sessions after restart.`
            )
        }
    } catch (error) {
        console.error(error instanceof Error ? error.message : "Could not configure admin access.")
        process.exitCode = 1
    }
}

if (require.main === module) runConfigureAdminAccessCli()
