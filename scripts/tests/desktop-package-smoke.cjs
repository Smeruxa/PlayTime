const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const { _electron } = require("playwright")
const { version } = require("../../package.json")
const appPath = path.resolve(process.env.DESKTOP_QA_APP || "")
const output = path.resolve(process.env.DESKTOP_QA_OUTPUT || `artifacts/desktop-${version}-local/browser`)
let application, temporary
const errors = [],
    blocked = [],
    records = []
;(async () => {
    assert(appPath.endsWith(".app"), "Set DESKTOP_QA_APP to the extracted local application")
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), "playtime-packaged-qa-"))
    const profile = path.join(temporary, "profile")
    await fs.mkdir(output, { recursive: true })
    application = await _electron.launch({
        executablePath: path.join(appPath, "Contents/MacOS/PlayTime"),
        args: [`--user-data-dir=${profile}`],
        env: { ...process.env, SITE_ORIGIN: "http://127.0.0.1:9" },
        timeout: 30000
    })
    const metadata = await application.evaluate(({ app }) => ({
        version: app.getVersion(),
        packaged: app.isPackaged,
        userData: app.getPath("userData")
    }))
    assert.equal(metadata.version, version)
    assert.equal(metadata.packaged, true)
    assert.equal(
        await fs.realpath(metadata.userData),
        await fs.realpath(profile),
        "Packaged QA never uses the real application profile"
    )
    await application.context().route(/^https?:/, (route) => {
        blocked.push({ method: route.request().method(), origin: new URL(route.request().url()).origin })
        return route.abort()
    })
    const page = await application.firstWindow()
    page.on("pageerror", (error) => errors.push(error.message))
    await page.getByRole("heading", { name: "Вход в аккаунт", exact: true }).waitFor()
    for (const [width, height] of [
        [960, 600],
        [1280, 800]
    ]) {
        await application.evaluate(
            ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size),
            [width, height]
        )
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(150)
        const styles = await page.evaluate(() => ({
            viewport: [innerWidth, innerHeight],
            overflowX: document.documentElement.scrollWidth > innerWidth,
            linked: [...document.querySelectorAll('link[rel="stylesheet"]')].some((link) =>
                link.href.endsWith("scrollbars.css")
            ),
            scrollbars: [...document.querySelectorAll("body *")]
                .filter(
                    (element) =>
                        element.clientHeight > 0 &&
                        element.scrollHeight > element.clientHeight + 2 &&
                        /auto|scroll/.test(getComputedStyle(element).overflowY)
                )
                .map((element) => ({
                    width: getComputedStyle(element, "::-webkit-scrollbar").width,
                    color: getComputedStyle(element, "::-webkit-scrollbar-thumb").backgroundColor
                }))
        }))
        assert.deepEqual(styles.viewport, [width, height])
        assert.equal(styles.overflowX, false)
        assert.equal(styles.linked, true)
        for (const scrollbar of styles.scrollbars) assert.equal(scrollbar.width, "8px")
        await page.screenshot({ path: path.join(output, `packaged-login-${width}x${height}.png`) })
        records.push(styles)
    }
    assert.deepEqual(errors, [])
    await fs.writeFile(
        path.join(output, "report.json"),
        JSON.stringify(
            {
                passed: true,
                metadata: { ...metadata, userData: "isolated-temporary-profile" },
                records,
                errors,
                blocked,
                actualPackagedBinary: true,
                signedInAccountUsed: false
            },
            null,
            4
        )
    )
    console.log(JSON.stringify({ passed: true, output }))
})()
    .catch(async (error) => {
        console.error(error)
        await fs.mkdir(output, { recursive: true })
        await fs.writeFile(
            path.join(output, "failure.json"),
            JSON.stringify({ error: String(error), records, errors, blocked }, null, 4)
        )
        process.exitCode = 1
    })
    .finally(async () => {
        await application?.close()
        if (temporary) await fs.rm(temporary, { recursive: true, force: true })
    })
