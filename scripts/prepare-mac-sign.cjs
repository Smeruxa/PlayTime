const { createRequire } = require("node:module")

async function ensureSigningIdentity(options, findIdentity) {
    if (options.identity !== undefined) return
    if (!(await findIdentity())) options.identity = "-"
}

module.exports = async function prepareMacSigning(context) {
    if (context.electronPlatformName !== "darwin") return
    const builderRequire = createRequire(
        require.resolve("app-builder-lib", { paths: [require.resolve("electron-builder")] })
    )
    const { findIdentity } = builderRequire("./codeSign/macCodeSign")
    const packager = context.packager
    await ensureSigningIdentity(packager.platformSpecificBuildOptions, async () => {
        const { keychainFile } = await packager.codeSigningInfo.value
        return findIdentity("Developer ID Application", undefined, keychainFile)
    })
}

module.exports.ensureSigningIdentity = ensureSigningIdentity
