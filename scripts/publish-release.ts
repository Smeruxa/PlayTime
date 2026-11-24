import { publishPlatform, readPackageVersion, repoRoot, verifyFeed, readReleaseProfile } from "./lib/release"

function parseArgs(argv: string[]) {
    let platform: "darwin" | "win32" | null = null
    let notes = ""
    let version = ""
    let stage = false
    let filesOnly = false
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a === "--platform" && argv[i + 1]) platform = argv[++i] as "darwin" | "win32"
        if (a === "--notes" && argv[i + 1]) notes = argv[++i]
        if (a === "--version" && argv[i + 1]) version = argv[++i]
        if (a === "--stage") stage = true
        if (a === "--files-only") filesOnly = true
    }
    if (platform !== "darwin" && platform !== "win32") {
        throw new Error(
            "Usage: publish-release --platform darwin|win32 [--version 1.5.0] [--notes text] [--stage | --files-only]"
        )
    }
    return { platform, notes, version, stage, filesOnly }
}

function main() {
    const root = repoRoot()
    const deployEnv = readReleaseProfile(root)
    const siteOrigin = deployEnv.SITE_ORIGIN || "https://smeruxa.ru"
    const { platform, notes, version: versionArg, stage, filesOnly } = parseArgs(process.argv.slice(2))
    const version = versionArg || readPackageVersion(root)

    publishPlatform({ platform, version, notes, root, publishLatest: !stage, filesOnly })
    if (!stage && !filesOnly) verifyFeed(platform, version, siteOrigin)
    console.log(
        `\nUploaded ${platform} ${version} (${filesOnly ? "files verified" : stage ? "staged" : "published as latest"}).`
    )
}

main()
