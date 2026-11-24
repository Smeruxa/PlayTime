const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs/promises')
const { once } = require('node:events')
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
let server, browser
;(async () => {
    server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>PlayTime mobile capability fixture</body></html>') })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const profiles = [
        { device: 'iPhone 15', engine: 'webkit' },
        ...(process.env.WEB_BROWSER_PATH ? [{ device: 'Pixel 7', engine: 'chromium', executablePath: process.env.WEB_BROWSER_PATH }] : [])
    ]
    const results = []
    for (const profile of profiles) {
        browser = await playwright[profile.engine].launch({ headless: true, ...(profile.executablePath ? { executablePath: profile.executablePath } : {}) })
        const context = await browser.newContext({ ...playwright.devices[profile.device], serviceWorkers: 'block' })
        const page = await context.newPage()
        await page.goto(`http://127.0.0.1:${server.address().port}`)
        await page.evaluate(() => {
            const button = document.createElement('button')
            button.id = 'touch-target'; button.textContent = 'Touch test'
            button.addEventListener('pointerdown', event => { window.touchProbe = event.pointerType })
            document.body.append(button)
        })
        await page.tap('#touch-target')
        const result = await page.evaluate(async () => {
            const Audio = window.AudioContext || window.webkitAudioContext
            const context = Audio ? new Audio() : null
            const capabilities = {
                userAgent: navigator.userAgent,
                viewport: { width: window.innerWidth, height: window.innerHeight },
                touchPoints: navigator.maxTouchPoints,
                tapPointerType: window.touchProbe,
                secureContext: window.isSecureContext,
                indexedDB: typeof indexedDB !== 'undefined',
                webLocks: typeof navigator.locks?.request === 'function',
                webCrypto: !!crypto.subtle,
                microphoneAPI: typeof navigator.mediaDevices?.getUserMedia === 'function',
                screenCaptureAPI: typeof navigator.mediaDevices?.getDisplayMedia === 'function',
                audioWorklet: !!context?.audioWorklet,
                mediaRecorder: typeof MediaRecorder !== 'undefined',
                recordingTypes: typeof MediaRecorder === 'undefined' ? [] : ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].filter(type => MediaRecorder.isTypeSupported(type)),
                notifications: typeof Notification !== 'undefined',
                notificationPermission: typeof Notification === 'undefined' ? null : Notification.permission
            }
            await context?.close()
            return capabilities
        })
        assert.equal(result.tapPointerType, 'touch')
        for (const required of ['secureContext', 'indexedDB', 'webLocks', 'webCrypto', 'microphoneAPI', 'audioWorklet', 'mediaRecorder']) assert.equal(result[required], true, `${profile.device}: ${required}`)
        assert.ok(result.recordingTypes.length > 0)
        results.push({ profile: profile.device, engine: profile.engine, browserVersion: browser.version(), ...result })
        await browser.close(); browser = null
    }
    const report = { passed: true, physicalHardware: false, permissionsRequested: false, captureStarted: false, productPolicy: { outgoingScreenShare: 'disabled in web app', incomingScreenShare: 'supported' }, limitation: 'Native API presence does not enable outgoing screen sharing in PlayTime web. Touch and mobile user-agent emulation uses desktop browser engines; physical iOS/Android media and OS permission behavior is not covered.', results }
    if (process.env.WEB_MOBILE_REPORT) await fs.writeFile(process.env.WEB_MOBILE_REPORT, JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report))
})().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)) })
