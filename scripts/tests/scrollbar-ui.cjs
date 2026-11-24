const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
const root = path.resolve(__dirname, "../..")
const output = path.resolve(process.env.SCROLLBAR_QA_OUTPUT || "artifacts/scrollbar-ui-red")
let server, browser, temporary
const electronMode = process.env.SCROLLBAR_QA_ELECTRON === "1"
const otpRequests = []
const records = [],
    errors = []
async function inspect(page, name) {
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(350)
    const scrolls = await page.evaluate(() => {
        document.querySelectorAll("[data-scroll-qa]").forEach((element) => element.removeAttribute("data-scroll-qa"))
        let counter = 0
        return [...new Set([document.scrollingElement, ...document.querySelectorAll("*")])]
            .filter((element) => element instanceof HTMLElement)
            .flatMap((element) => {
                const css = getComputedStyle(element),
                    box = element.getBoundingClientRect()
                const root = element === document.scrollingElement
                const y = element.scrollHeight > element.clientHeight + 1 && (root || /auto|scroll/.test(css.overflowY))
                const x = element.scrollWidth > element.clientWidth + 1 && (root || /auto|scroll/.test(css.overflowX))
                if ((!x && !y) || box.width < 5 || box.height < 5 || box.bottom <= 0 || box.top >= innerHeight)
                    return []
                const bar = getComputedStyle(element, "::-webkit-scrollbar"),
                    thumb = getComputedStyle(element, "::-webkit-scrollbar-thumb")
                const id = "scroll-qa-" + counter++
                element.dataset.scrollQa = id
                return [
                    {
                        id,
                        tag: element.tagName,
                        classes: element.className,
                        root,
                        reverse: css.flexDirection === "column-reverse",
                        interactive: element.contains(
                            document.elementFromPoint(
                                Math.max(1, Math.min(box.left + box.width / 2, innerWidth - 5)),
                                Math.max(1, Math.min(box.top + box.height / 2, innerHeight - 5))
                            )
                        ),
                        x,
                        y,
                        client: [element.clientWidth, element.clientHeight],
                        content: [element.scrollWidth, element.scrollHeight],
                        overflow: [css.overflowX, css.overflowY],
                        scrollbarWidth: css.scrollbarWidth,
                        scrollbarColor: css.scrollbarColor,
                        webkitWidth: bar.width,
                        webkitDisplay: bar.display,
                        thumbColor: thumb.backgroundColor,
                        nativeDefault: css.scrollbarColor === "auto" && bar.width === "auto",
                        hidden: css.scrollbarWidth === "none" || bar.display === "none"
                    }
                ]
            })
    })
    await page.screenshot({ path: path.join(output, name + "-before.png"), fullPage: false })
    const proof = []
    for (const scroll of scrolls) {
        const element = page.locator(`[data-scroll-qa="${scroll.id}"]`)
        if (!scroll.interactive) {
            proof.push({ id: scroll.id, coveredByOverlay: true })
            continue
        }
        const originalTabindex = await element.getAttribute("tabindex")
        const before = await element.evaluate((element) => {
            element.scrollTop = 0
            return element.scrollTop
        })
        const box = await element.boundingBox()
        await page.mouse.move(
            Math.max(1, Math.min(box.x + box.width / 2, viewport.width - 5)),
            Math.max(1, Math.min(box.y + box.height / 2, viewport.height - 5))
        )
        await page.mouse.wheel(0, scroll.reverse ? -180 : 180)
        await page.waitForTimeout(120)
        const wheel = await element.evaluate((element) => element.scrollTop)
        await element.evaluate((element) => {
            element.tabIndex = 0
            element.focus({ preventScroll: true })
            element.scrollTop = 0
        })
        await page.keyboard.press(scroll.reverse ? "PageUp" : "PageDown")
        await page.waitForTimeout(120)
        const keyboard = await element.evaluate((element) => element.scrollTop)
        await element.evaluate((element, tabindex) => {
            element.blur()
            if (tabindex === null) element.removeAttribute("tabindex")
            else element.setAttribute("tabindex", tabindex)
        }, originalTabindex)
        proof.push({ id: scroll.id, before, wheel, keyboard })
    }
    await page.screenshot({ path: path.join(output, name + ".png"), fullPage: false })
    records.push({ name, viewport, scrolls, proof })
}
;(async () => {
    await fs.mkdir(output, { recursive: true })
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), "playtime-scrollbar-"))
    const { createServer } = await import("vite"),
        { default: react } = await import("@vitejs/plugin-react")
    server = await createServer({
        root,
        publicDir: path.join(root, "apps/frontend/public"),
        optimizeDeps: { entries: ["scripts/fixtures/profile-ui.tsx", "scripts/fixtures/scrollbar-ui.tsx"] },
        configFile: false,
        cacheDir: path.join(temporary, "vite"),
        define: { "process.env.REACT_APP_WEB_BUILD": '"false"', "process.env.REACT_APP_API_BASE": '"/playtime"' },
        server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
        plugins: [
            react(),
            {
                name: "scrollbar-fixture",
                configureServer(server) {
                    server.middlewares.use("/__scrollbar", async (request, response) => {
                        const profile =
                            new URL(request.url, "http://localhost").searchParams.get("surface") === "profile"
                        response.setHeader("Content-Type", "text/html")
                        response.end(
                            await server.transformIndexHtml(
                                "/__scrollbar",
                                `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/scrollbars.css"></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/${profile ? "profile-ui" : "scrollbar-ui"}.tsx"></script></body></html>`
                            )
                        )
                    })
                }
            }
        ]
    })
    await server.listen()
    const base = `http://127.0.0.1:${server.httpServer.address().port}`
    let electronPage
    if (electronMode) {
        const main = path.join(temporary, "electron-main.cjs"),
            preload = path.join(temporary, "electron-preload.cjs")
        await fs.writeFile(
            preload,
            "const {contextBridge}=require('electron'); contextBridge.exposeInMainWorld('electronAPI',{on(){},off(){},setCallActive(){}}); contextBridge.exposeInMainWorld('windowControls',{});"
        )
        await fs.writeFile(
            main,
            `const {app,BrowserWindow}=require('electron'); app.setPath('userData',${JSON.stringify(path.join(temporary, "electron-profile"))}); app.commandLine.appendSwitch('disable-features','OverlayScrollbar,OverlayScrollbars,MacOverlayScrollbars'); app.whenReady().then(()=>{const win=new BrowserWindow({width:960,height:600,useContentSize:true,frame:false,show:true,webPreferences:{preload:${JSON.stringify(preload)},contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});win.loadURL('about:blank');});`
        )
        browser = await _electron.launch({ args: [main], executablePath: require("electron") })
        electronPage = await browser.firstWindow()
    } else {
        browser = await chromium.launch({
            headless: true,
            args: ["--disable-features=OverlayScrollbar,OverlayScrollbars,MacOverlayScrollbars"]
        })
    }
    const viewports = electronMode
        ? [
              [960, 600],
              [1280, 800]
          ]
        : [
              [800, 480],
              [960, 600],
              [1280, 800],
              [1400, 900]
          ]
    for (const [width, height] of viewports) {
        const page = electronMode
            ? electronPage
            : await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" })
        if (electronMode) {
            await browser.evaluate(
                ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height),
                { width, height }
            )
            await page.emulateMedia({ reducedMotion: "reduce" })
        }
        await page.addInitScript(() => {
            Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
                configurable: true,
                value: async () =>
                    Array.from({ length: 30 }, (_, index) => ({
                        kind: "audioinput",
                        deviceId: `qa-microphone-${index}`,
                        groupId: "qa",
                        label: `Микрофон ${index + 1}`
                    }))
            })
        })
        page.on("pageerror", (error) => errors.push(error.stack || error.message))
        await page.route("**/*", (route) => {
            const url = new URL(route.request().url())
            if (url.origin === base && url.pathname.startsWith("/playtime/auth/")) {
                const body = route.request().postDataJSON()
                otpRequests.push({ path: url.pathname, code: typeof body?.code === "string" ? body.code : null })
                return route.fulfill({
                    json: {
                        success: true,
                        message: "Изолированный тест",
                        challengeId: "isolated-challenge",
                        email: "qa@example.test",
                        expiresAt: new Date(Date.now() + 600000).toISOString(),
                        retryAfter: 0
                    }
                })
            }
            if (url.origin === base || ["data:", "blob:"].includes(url.protocol)) return route.continue()
            return route.fulfill({
                status: 200,
                contentType: "image/svg+xml",
                body: '<svg xmlns="http://www.w3.org/2000/svg"/>'
            })
        })
        if (process.env.SCROLLBAR_OTP_ONLY === "1") {
            for (const surface of ["otp-email", "otp-recovery", "otp-revoke"]) {
                await page.goto(`${base}/__scrollbar?surface=${surface}`)
                await page.locator("#root > *").first().waitFor()
                if (surface === "otp-email") await page.locator('input[type="email"]').fill("qa@example.test")
                if (surface === "otp-recovery") {
                    await page.getByRole("button", { name: "Забыли пароль?", exact: true }).click()
                    await page.locator('input[type="email"]').fill("qa@example.test")
                    await page.getByRole("button", { name: "Отправить код", exact: true }).click()
                }
                if (surface === "otp-revoke")
                    await page.getByRole("button", { name: "Отправить код на почту", exact: true }).click()
                const input = page.locator('input[autocomplete="one-time-code"]')
                await input.waitFor()
                await input.fill("12345")
                assert.equal(await input.evaluate((element) => element.checkValidity()), false)
                await input.fill("012345")
                assert.equal(await input.inputValue(), "012345", "Leading zero must be preserved")
                assert.equal(
                    await input.evaluate((element) => element.checkValidity()),
                    true,
                    "Six decimal digits pass native browser validity"
                )
                assert.equal(await input.getAttribute("inputmode"), "numeric")
                assert.equal(await input.getAttribute("maxlength"), "6")
                if (surface === "otp-recovery") {
                    await page.locator('input[type="password"]').nth(0).fill("QaNumeric12345!Test")
                    await page.locator('input[type="password"]').nth(1).fill("QaNumeric12345!Test")
                }
                await page.screenshot({ path: path.join(output, `${surface}-${width}x${height}.png`) })
                await page
                    .getByRole("button", {
                        name:
                            surface === "otp-email"
                                ? "Подтвердить почту"
                                : surface === "otp-recovery"
                                  ? "Изменить пароль"
                                  : "Подтвердить отключение",
                        exact: true
                    })
                    .click()
                await page.waitForTimeout(100)
                assert.equal(
                    otpRequests.at(-1)?.code,
                    "012345",
                    "Actual production form submits the exact six-digit code"
                )
                records.push({
                    name: `${surface}-${width}x${height}`,
                    viewport: { width, height },
                    scrolls: [],
                    proof: [
                        {
                            fiveDigitsInvalid: true,
                            sixDigitsValid: true,
                            leadingZeroPreserved: true,
                            submittedCode: otpRequests.at(-1)?.code
                        }
                    ]
                })
            }
            if (!electronMode) await page.close()
            continue
        }
        await page.goto(base + "/")
        await page.locator("#root > *").first().waitFor()
        const mainStylesheet = await page.locator('link[rel="stylesheet"][href$="scrollbars.css"]').count()
        if (mainStylesheet !== 1) throw new Error("Actual main entry must load the shipping scrollbar stylesheet")
        await inspect(page, `main-entry-${width}x${height}`)
        for (const surface of ["auth", "welcome", "profile", "friends", "chat", "modal", "settings"]) {
            await page.goto(`${base}/__scrollbar?surface=${surface}`)
            await page.locator("#root > *").first().waitFor()
            await inspect(page, `${surface}-${width}x${height}`)
            if (surface === "settings") {
                const dialog = page.getByRole("dialog", { name: "Настройки", exact: true })
                const trigger = page.getByRole("combobox", { name: "Микрофон", exact: true })
                await trigger.click()
                const list = page.getByRole("listbox")
                await list.waitFor()
                assert.equal(await page.getByRole("option").count(), 31)
                await trigger.press("Home")
                await page.waitForTimeout(120)
                const bounds = await list.boundingBox()
                const actualViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
                assert(
                    bounds.x >= 0 &&
                        bounds.y >= 0 &&
                        bounds.x + bounds.width <= actualViewport.width &&
                        bounds.y + bounds.height <= actualViewport.height
                )
                const style = await list.evaluate((element) => {
                    const css = getComputedStyle(element),
                        bar = getComputedStyle(element, "::-webkit-scrollbar")
                    return {
                        tag: element.tagName,
                        classes: element.className,
                        scrollbarColor: css.scrollbarColor,
                        webkitWidth: bar.width,
                        nativeDefault: css.scrollbarColor === "auto" && bar.width === "auto",
                        hidden: css.scrollbarWidth === "none" || bar.display === "none"
                    }
                })
                await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
                await page.mouse.wheel(0, 180)
                await page.waitForTimeout(120)
                const wheel = await list.evaluate((element) => element.scrollTop)
                assert(wheel > 0, "Actual Settings dropdown responds to wheel")
                if (process.env.SCROLLBAR_SELECT_DRAG === "1") {
                    const geometry = await list.evaluate((element) => ({
                        height: element.clientHeight,
                        content: element.scrollHeight,
                        top: element.scrollTop
                    }))
                    const thumbHeight = Math.max(24, (geometry.height * geometry.height) / geometry.content)
                    const thumbTop =
                        (geometry.top / (geometry.content - geometry.height)) * (geometry.height - thumbHeight)
                    await page.mouse.move(bounds.x + bounds.width - 4, bounds.y + thumbTop + thumbHeight / 2)
                    await page.mouse.down()
                    await page.mouse.move(bounds.x + bounds.width - 4, bounds.y + thumbTop + thumbHeight / 2 + 35, {
                        steps: 6
                    })
                    await page.mouse.up()
                    await page.waitForTimeout(120)
                    const dismissed = (await list.count()) === 0
                    records.push({
                        name: `settings-thumb-drag-${width}x${height}`,
                        viewport: actualViewport,
                        scrolls: [],
                        proof: [
                            {
                                dismissed,
                                before: wheel,
                                after: dismissed ? null : await list.evaluate((element) => element.scrollTop)
                            }
                        ]
                    })
                    assert.equal(dismissed, false, "Dragging the dropdown scrollbar must not dismiss it")
                    assert.equal(
                        await trigger.evaluate((element) => document.activeElement === element),
                        true,
                        "Scrollbar release restores combobox keyboard focus"
                    )
                    assert(
                        (await list.evaluate((element) => element.scrollTop)) > wheel,
                        "Scrollbar thumb drag actually scrolls the dropdown"
                    )
                }
                await trigger.press("End")
                await page.waitForTimeout(120)
                const keyboard = await list.evaluate((element) => element.scrollTop)
                assert(keyboard > wheel, "End reaches the last microphone in the scrollable list")
                await page.screenshot({ path: path.join(output, `settings-select-${width}x${height}.png`) })
                await trigger.press("Escape")
                await list.waitFor({ state: "detached" })
                assert.equal(await dialog.count(), 1, "First Escape closes only the dropdown")
                assert.equal(await trigger.evaluate((element) => document.activeElement === element), true)
                await trigger.click()
                await trigger.press("End")
                await trigger.press("Enter")
                assert.match(await trigger.innerText(), /Микрофон 30/)
                await trigger.click()
                await trigger.press("Tab")
                await list.waitFor({ state: "detached" })
                assert.equal(
                    await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')),
                    true,
                    "Tab retains the modal focus trap"
                )
                await page.keyboard.press("Escape")
                await dialog.waitFor({ state: "detached" })
                records.push({
                    name: `settings-select-${width}x${height}`,
                    viewport: actualViewport,
                    scrolls: [style],
                    proof: [
                        {
                            wheel,
                            keyboard,
                            firstEscapeKeptModal: true,
                            secondEscapeClosedModal: true,
                            selectedLastMicrophone: true,
                            tabStayedInModal: true
                        }
                    ]
                })
            }
            if (surface === "chat") {
                await page.locator("[data-chat-emoji-toggle]").click()
                await inspect(page, `emoji-${width}x${height}`)
            }
        }
        await page.addInitScript(() => {
            window.notifyAPI = {
                send() {},
                on(event, callback) {
                    if (event === "set-notifications")
                        setTimeout(
                            () =>
                                callback(
                                    Array.from({ length: 25 }, (_, index) => ({
                                        id: index,
                                        name: `Друг ${index}`,
                                        text: "Проверка прокрутки уведомлений"
                                    }))
                                ),
                            20
                        )
                }
            }
            window.screenShareViewer = {
                onMixer(callback) {
                    setTimeout(
                        () =>
                            callback({
                                screenLabel: "Экран собеседника",
                                screenMuted: false,
                                screen: 100,
                                screenAvailable: true
                            }),
                        20
                    )
                },
                requestMixer() {},
                onFrame() {},
                changeMixer() {},
                close() {}
            }
        })
        await page.goto(`${base}/notify.html`)
        await page.locator(".card").first().waitFor()
        await inspect(page, `notifications-${width}x${height}`)
        await page.goto(`${base}/screen-share-viewer.html`)
        await page.getByRole("button", { name: "Громкость демонстрации", exact: true }).click()
        await inspect(page, `standalone-viewer-${width}x${height}`)
        if (!electronMode) await page.close()
    }
    await fs.writeFile(
        path.join(output, "report.json"),
        JSON.stringify(
            {
                browser: electronMode ? await browser.evaluate(() => process.versions) : browser.version(),
                runtime: electronMode ? "Electron" : "Chromium",
                requestedOverlayFeatureDisabling: true,
                changedOsPreferences: false,
                otpRequests,
                records,
                errors
            },
            null,
            4
        ) + "\n"
    )
    if (process.env.SCROLLBAR_EXPECT_CUSTOM === "1") {
        assert.deepEqual(errors, [], "Production UI has no runtime errors")
        assert.equal(
            records.flatMap((record) => record.scrolls).filter((scroll) => scroll.nativeDefault || scroll.hidden)
                .length,
            0,
            "Every overflowing surface uses a visible custom scrollbar"
        )
    }
    console.log(
        JSON.stringify({
            output,
            nativeDefault: records.flatMap((record) =>
                record.scrolls
                    .filter((scroll) => scroll.nativeDefault)
                    .map((scroll) => ({
                        name: record.name,
                        tag: scroll.tag,
                        classes: scroll.classes,
                        root: scroll.root
                    }))
            ),
            errors
        })
    )
})()
    .catch(async (error) => {
        console.error(error)
        process.exitCode = 1
        await fs
            .writeFile(
                path.join(output, "failure.json"),
                JSON.stringify({ error: error.stack, records, errors }, null, 4)
            )
            .catch(() => {})
    })
    .finally(async () => {
        await browser?.close()
        await server?.close()
        if (temporary) await fs.rm(temporary, { recursive: true, force: true })
    })
