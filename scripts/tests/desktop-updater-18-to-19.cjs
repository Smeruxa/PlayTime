const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const crypto = require("node:crypto")
const { promisify } = require("node:util")
const execFile = promisify(require("node:child_process").execFile)
const { _electron } = require("playwright")
const output = path.resolve("artifacts/desktop-2.0.19-local/previous18-updater")
const zip = path.resolve("dist/PlayTime-2.0.18-mac.zip")
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")
let application, temporary
;(async () => {
    assert.equal(process.env.DESKTOP_UPDATER_PUBLISHED_GO, "1", "Hold: root must approve published19 feed QA")
    const originalHash = sha(await fs.readFile(zip))
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), "playtime-previous18-qa-"))
    await fs.mkdir(output, { recursive: true })
    await execFile("ditto", ["-x", "-k", zip, temporary])
    const profile = path.join(temporary, "isolated-profile")
    application = await _electron.launch({
        executablePath: path.join(temporary, "PlayTime.app/Contents/MacOS/PlayTime"),
        args: [`--user-data-dir=${profile}`],
        env: { ...process.env, SITE_ORIGIN: "https://smeruxa.ru" },
        timeout: 30000
    })
    const metadata = await application.evaluate(({ app }) => ({
        version: app.getVersion(),
        packaged: app.isPackaged,
        userData: app.getPath("userData")
    }))
    assert.equal(metadata.version, "2.0.18")
    assert.equal(metadata.packaged, true)
    assert.equal(await fs.realpath(metadata.userData), await fs.realpath(profile))
    await application.context().route(/^https?:/, (route) => route.abort())
    const page = await application.firstWindow()
    await page.getByRole("heading", { name: "Вход в аккаунт", exact: true }).waitFor()
    const result = await page.evaluate(() => window.electronAPI.checkForUpdates())
    assert.equal(result.version, "2.0.19")
    await page.getByRole("button", { name: "Скачать (2.0.19)", exact: true }).waitFor()
    const updateState = await page.evaluate(() => window.electronAPI.getUpdateState())
    assert.deepEqual(updateState, { kind: "manual", version: "2.0.19" })
    await page.screenshot({ path: path.join(output, "actual18-public19-update.png") })
    assert.equal(sha(await fs.readFile(zip)), originalHash, "Immutable18 archive remains unchanged")
    await fs.writeFile(
        path.join(output, "report.json"),
        JSON.stringify(
            {
                passed: true,
                actualPreviousPackagedVersion: metadata.version,
                publicUpdateVersion: result.version,
                updateState,
                immutable18Sha256: originalHash,
                isolatedProfile: true,
                installPerformed: false,
                downloadClicked: false,
                manualReason: "Existing ad-hoc macOS build uses manual installer policy"
            },
            null,
            4
        )
    )
    console.log(JSON.stringify({ passed: true, output }))
})()
    .catch(async (error) => {
        console.error(error)
        if (temporary) {
            await fs.mkdir(output, { recursive: true })
            await fs.writeFile(path.join(output, "failure.json"), JSON.stringify({ error: String(error) }, null, 4))
        }
        process.exitCode = 1
    })
    .finally(async () => {
        await application?.close()
        if (temporary) await fs.rm(temporary, { recursive: true, force: true })
    })
