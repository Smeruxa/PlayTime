const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const { chromium } = require("playwright")
const origin = "https://smeruxa.ru"
const output = path.resolve("artifacts/production-native-handoff-2.0.20")
let browser,
    phase = "held"
const pages = [],
    results = [],
    errors = []
async function openDevice(user, device) {
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        permissions: ["microphone"],
        serviceWorkers: "block"
    })
    await context.addInitScript(() => {
        window.__handoffQa = { captures: 0, audioContexts: 0, peers: [] }
        const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
        navigator.mediaDevices.getUserMedia = (...args) => {
            window.__handoffQa.captures++
            return getUserMedia(...args)
        }
        const PC = window.RTCPeerConnection
        window.RTCPeerConnection = new Proxy(PC, {
            construct(target, args) {
                const pc = Reflect.construct(target, args)
                window.__handoffQa.peers.push(pc)
                return pc
            }
        })
        const Audio = window.AudioContext
        window.AudioContext = new Proxy(Audio, {
            construct(target, args) {
                window.__handoffQa.audioContexts++
                return Reflect.construct(target, args)
            }
        })
    })
    const page = await context.newPage()
    pages.push(page)
    page.on("pageerror", () => errors.push({ device, kind: "pageerror" }))
    await page.goto(origin + "/playtime/app/#/login")
    await page.locator('input[type="email"]').fill(user.email)
    await page.locator('input[type="password"]').fill(user.password)
    await page.getByRole("button", { name: "Войти", exact: true }).click()
    await page.getByRole("complementary", { name: "Список чатов" }).waitFor()
    return page
}
async function waitAudio(page) {
    await page.waitForFunction(
        async () => {
            for (const pc of window.__handoffQa.peers) {
                if (pc.connectionState !== "connected") continue
                const reports = await pc.getStats()
                for (const report of reports.values())
                    if (report.type === "inbound-rtp" && report.kind === "audio" && report.packetsReceived > 20)
                        return true
            }
            return false
        },
        null,
        { timeout: 45000 }
    )
}
;(async () => {
    assert.equal(process.env.PRODUCTION_NATIVE_HANDOFF_GO, "1")
    const finishFile = process.env.PRODUCTION_HANDOFF_FINISH_FILE
    assert(finishFile && finishFile.startsWith("/private/tmp/"))
    try {
        await fs.access(finishFile)
        throw new Error("Completion marker must be absent at start")
    } catch (error) {
        if (error.code !== "ENOENT") throw error
    }
    phase = "authorized-fixture-validation"
    const credentials = JSON.parse(
        await fs.readFile("/private/tmp/playtime-mobile-home-qa/qa19-dbf85913044b61e3.credentials.json", "utf8")
    )
    assert.deepEqual(
        credentials.users.map((user) => user.id),
        [22, 23]
    )
    await fs.mkdir(output, { recursive: true })
    browser = await chromium.launch({
        headless: true,
        args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
            "--mute-audio"
        ]
    })
    phase = "web-peer-login"
    const peer = await openDevice(credentials.users[1], "peer")
    phase = "waiting-for-root-phone-call"
    console.log("READY: browser peer is signed in; root may start the Android fixture call")
    await peer.getByRole("dialog", { name: "Входящий звонок" }).waitFor({ timeout: 180000 })
    await peer.getByRole("button", { name: "Принять", exact: true }).click()
    await waitAudio(peer)
    phase = "passive-desktop-login"
    const desktop = await openDevice(credentials.users[0], "desktop")
    await desktop.getByText("Звонок на другом устройстве", { exact: true }).waitFor()
    await desktop.waitForTimeout(1000)
    const passive = await desktop.evaluate(() => ({
        captures: window.__handoffQa.captures,
        audioContexts: window.__handoffQa.audioContexts,
        peers: window.__handoffQa.peers.length
    }))
    assert.deepEqual(passive, { captures: 0, audioContexts: 0, peers: 0 })
    await desktop.screenshot({ path: path.join(output, "desktop-passive.png") })
    phase = "explicit-desktop-claim"
    await desktop.getByRole("button", { name: "Продолжить звонок здесь", exact: true }).click()
    await waitAudio(desktop)
    await waitAudio(peer)
    await desktop.screenshot({ path: path.join(output, "desktop-claimed.png") })
    results.push({ passive, desktopInboundRtp: true, peerInboundRtp: true, explicitUiClaim: true })
    assert.deepEqual(errors, [])
    phase = "browser-proof-complete-phone-fgs-root-check-required"
    await fs.writeFile(
        path.join(output, "report.json"),
        JSON.stringify(
            {
                browserChecksPassed: true,
                actualProductionUi: true,
                fixtureUserIds: [22, 23],
                results,
                errors,
                nativeForegroundServiceStopped: "root-must-verify",
                accountsCreated: false,
                messagesSent: false,
                paymentsCreated: false
            },
            null,
            4
        )
    )
    console.log(
        "PASS: browser handoff proof complete; root must separately record phone mesh/foreground-service shutdown"
    )
    const deadline = Date.now() + 180000
    while (Date.now() < deadline) {
        try {
            await fs.access(finishFile)
            break
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    await desktop.getByRole("button", { name: "Завершить звонок", exact: true }).click()
    await desktop.getByRole("button", { name: "Завершить звонок", exact: true }).waitFor({ state: "hidden" })
    await peer.getByRole("button", { name: "Завершить звонок", exact: true }).waitFor({ state: "hidden" })
    const finalReport = JSON.parse(await fs.readFile(path.join(output, "report.json"), "utf8"))
    finalReport.currentOwnerEndedCall = true
    await fs.writeFile(path.join(output, "report.json"), JSON.stringify(finalReport, null, 4))
    console.log("PASS: current owner explicitly ended the dedicated QA call")
})()
    .catch(async (error) => {
        console.error("Production native handoff did not complete: " + phase)
        if (browser) {
            await fs.mkdir(output, { recursive: true })
            await fs.writeFile(
                path.join(output, "failure.json"),
                JSON.stringify({ phase, errorType: error.name, errors }, null, 4)
            )
        }
        process.exitCode = 1
    })
    .finally(async () => {
        await browser?.close()
    })
