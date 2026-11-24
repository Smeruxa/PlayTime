const fs = require("node:fs")
const path = require("node:path")

const appsRoot = path.join(__dirname, "..", "apps")
const workspaces = ["auth-api", "chat-api", "room-api", "gateway"]
const runtimeDirectories = [...workspaces, "shared", "database"]
const runtimeExtensions = new Set([".ts", ".js", ".cjs", ".mjs", ".sql"])
const excludedDirectories = new Set(["tests", "__tests__", "fixtures", "data", "coverage", "node_modules", "keys", "secrets"])
const publicPushCertificate = path.join(appsRoot, "gateway/push/certificates/russian-trusted-root-ca.pem")
const privateFile = /\.(?:key|pem|pfx|p12|keystore|jks|log)$/i
const testFile = /\.(?:spec|test|fixture)\.[cm]?[jt]sx?$/i
const siteDist = path.join(appsRoot, "site", "dist")
const compatibilityScripts = {
    "runMigrations.ts": ["database/runMigrations", "runMigrationsCli"],
    "grantRuntimePrivileges.ts": ["database/grantRuntimePrivileges", "runRuntimeGrantCli"],
    "configureAdminAccess.ts": ["gateway/admin/configureAdminAccess", "runConfigureAdminAccessCli"]
}

function requireFile(relativePath) {
    const file = path.join(appsRoot, relativePath)
    if (!fs.lstatSync(file, { throwIfNoEntry: false })?.isFile()) {
        throw new Error(`Missing runtime input apps/${relativePath}`)
    }
}

function shouldCopy(source, includeStaticAssets = false) {
    const name = path.basename(source)
    if (name.startsWith(".") || excludedDirectories.has(name) || testFile.test(name)) return false
    if (!includeStaticAssets && name === "dist") return false
    const stat = fs.lstatSync(source)
    if (stat.isDirectory()) return true
    if (!stat.isFile()) return false
    if (source === publicPushCertificate) return true
    if (privateFile.test(name)) return false
    return includeStaticAssets || name === "package.json" || runtimeExtensions.has(path.extname(name))
}

function cliWrapper(target, entrypoint) {
    return `import { ${entrypoint} } from "../${target}"

if (require.main === module) void ${entrypoint}()
`
}

function packageBackend(destination) {
    for (const file of [
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        ...workspaces.flatMap((name) => [`${name}/package.json`, `${name}/main.ts`]),
        "gateway/legacy.ts",
        "gateway/ecosystem.config.cjs",
        "gateway/push/certificates/russian-trusted-root-ca.pem",
        "room-api/workers/denoise.mjs",
        "database/schema.sql",
        ...Object.values(compatibilityScripts).map(([target]) => `${target}.ts`),
        "site/dist/index.html",
        "site/dist/app/index.html"
    ]) requireFile(file)
    const migrations = path.join(appsRoot, "database/migrations")
    if (!fs.readdirSync(migrations).some((name) => name.endsWith(".sql") && shouldCopy(path.join(migrations, name)))) {
        throw new Error("No database migrations in apps/database/migrations")
    }

    const manifest = JSON.parse(fs.readFileSync(path.join(appsRoot, "package.json"), "utf8"))
    if (
        !Array.isArray(manifest.workspaces) ||
        manifest.workspaces.length !== workspaces.length ||
        !workspaces.every((workspace) => manifest.workspaces.includes(workspace))
    ) {
        throw new Error("apps/package.json must declare the four server workspaces")
    }

    const output = path.resolve(destination)
    if (!fs.existsSync(output)) fs.mkdirSync(output)
    if (!fs.lstatSync(output).isDirectory() || fs.readdirSync(output).length > 0) {
        throw new Error("The staging directory must be empty")
    }
    const relativeToApps = path.relative(fs.realpathSync(appsRoot), fs.realpathSync(output))
    if (!relativeToApps || (!relativeToApps.startsWith(`..${path.sep}`) && relativeToApps !== "..")) {
        throw new Error("The staging directory must be outside apps/")
    }

    for (const directory of runtimeDirectories) {
        fs.cpSync(path.join(appsRoot, directory), path.join(output, directory), {
            recursive: true,
            filter: (source) => shouldCopy(source)
        })
    }
    fs.cpSync(siteDist, path.join(output, "site", "dist"), {
        recursive: true,
        filter: (source) => shouldCopy(source, true)
    })
    for (const file of ["package-lock.json", "tsconfig.json"]) {
        fs.copyFileSync(path.join(appsRoot, file), path.join(output, file))
    }
    manifest.scripts.start = "tsx server.ts"
    fs.writeFileSync(path.join(output, "package.json"), JSON.stringify(manifest, null, 4) + "\n")
    fs.copyFileSync(path.join(appsRoot, "gateway/ecosystem.config.cjs"), path.join(output, "ecosystem.config.cjs"))
    fs.writeFileSync(
        path.join(output, "server.ts"),
        `import "dotenv/config"
import { resolve } from "node:path"

process.env.PLAYTIME_BACKEND_ROOT ||= __dirname
process.env.SITE_DIST_PATH ||= resolve(__dirname, "site", "dist")
process.env.SKIP_SITE_BUILD ||= "1"
require("./gateway/legacy")
`
    )
    const scriptsDir = path.join(output, "scripts")
    fs.mkdirSync(scriptsDir)
    for (const [name, [target, entrypoint]] of Object.entries(compatibilityScripts)) {
        fs.writeFileSync(path.join(scriptsDir, name), cliWrapper(target, entrypoint))
    }
    console.log(`Runtime staged in ${output}`)
}

try {
    if (process.argv.length !== 3) throw new Error("Usage: node scripts/package-backend.cjs EMPTY_STAGE_DIRECTORY")
    packageBackend(process.argv[2])
} catch (error) {
    console.error(error.message)
    process.exitCode = 1
}
