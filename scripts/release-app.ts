import {
    bumpSemver,
    defaultPlatform,
    platformsFromArg,
    publishPlatform,
    readReleaseProfile,
    readPackageVersion,
    repoRoot,
    runBuild,
    verifyFeed,
    writePackageVersion,
    type Platform
} from "./lib/release"

type BumpKind = "patch" | "minor" | "major"

function parseArgs(argv: string[]) {
    let platformArg = defaultPlatform()
    let bump: BumpKind | null = "patch"
    let version = ""
    let notes = ""
    let skipBuild = false
    let noBump = false
    let forceReactBuild = false

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a === "--platform" && argv[i + 1]) platformArg = argv[++i]!
        else if (a === "--bump" && argv[i + 1]) bump = argv[++i] as BumpKind
        else if (a === "--version" && argv[i + 1]) version = argv[++i]!
        else if (a === "--notes" && argv[i + 1]) notes = argv[++i]!
        else if (a === "--skip-build") skipBuild = true
        else if (a === "--no-bump") noBump = true
        else if (a === "--force-react-build") forceReactBuild = true
        else if (a === "--help" || a === "-h") {
            console.log(`Usage: npm run release -- [options]

Options:
  --platform darwin|win32|all   default: current OS (darwin on Mac)
  --bump patch|minor|major      bump package.json before build (default: patch)
  --version X.Y.Z               explicit version (overrides --bump)
  --no-bump                     keep current package.json version
  --notes "text"                release notes for admin/updater
  --skip-build                  only upload existing dist/ artifacts
  --force-react-build           пересобрать React даже если build/ свежий

Examples:
  npm run release -- --notes "Fix calls"
  npm run release:mac -- --notes "mac only"
  npm run release:all -- --bump minor --notes "Big update"
`)
            process.exit(0)
        }
    }

    if (noBump) bump = null
    if (version) bump = null

    const platforms = platformsFromArg(platformArg)
    const buildTarget: Platform | "all" = platforms.length === 2 ? "all" : platforms[0]!

    return { platforms, buildTarget, bump, version, notes, skipBuild, forceReactBuild }
}

function resolveVersion(current: string, bump: BumpKind | null, explicit: string): string {
    if (explicit) return explicit
    if (bump) return bumpSemver(current, bump)
    return current
}

function main() {
    const root = repoRoot()
    const args = parseArgs(process.argv.slice(2))
    const current = readPackageVersion(root)
    const nextVersion = resolveVersion(current, args.bump, args.version)

    if (nextVersion !== current) {
        console.log(`Version: ${current} → ${nextVersion}`)
        writePackageVersion(nextVersion, root)
    } else {
        console.log(`Version: ${nextVersion}`)
    }

    if (!args.skipBuild) {
        runBuild(args.buildTarget, root, { forceReactBuild: args.forceReactBuild })
    } else {
        console.log("Skip build — using dist/ as-is")
    }

    const deployEnv = readReleaseProfile(root)
    const siteOrigin = deployEnv.SITE_ORIGIN || "https://smeruxa.ru"

    for (const platform of args.platforms) {
        publishPlatform({ platform, version: nextVersion, notes: args.notes, root })
        verifyFeed(platform, nextVersion, siteOrigin)
    }

    console.log(`\nDone. ${args.platforms.join(", ")} ${nextVersion} published as latest.`)
    console.log(`Admin: ${siteOrigin.replace(/\/$/, "")}/playtime/admin/release-panel`)
    console.log("Windows users download the installer from the PlayTime website.")
}

main()
