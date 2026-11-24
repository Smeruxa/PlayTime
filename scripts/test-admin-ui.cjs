const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
require('tsx/cjs')
const { listPlansPublic } = require('../apps/shared/subscription/planCatalog.ts')
const base = process.env.ADMIN_UI_URL || 'http://127.0.0.1:4175/playtime'
const output = process.env.ADMIN_SCREENSHOT_DIR || path.resolve('artifacts/admin-ui')
let activeBrowser
const now = '2026-10-25T10:00:00.000Z'
const releases = ['darwin', 'win32'].flatMap((platform, index) => ['2.0.5', '2.0.4'].map((version, i) => ({
    id: index * 2 + i + 1, version, platform, filename: platform === 'darwin' ? `PlayTime-${version}-arm64.dmg` : `PlayTime-${version}-Setup.exe`,
    fileSize: 120_586_240, isPublished: i === 0, isLatest: i === 0, releaseNotes: 'Улучшено восстановление звонка при смене сети. Исправлена передача звука демонстрации.',
    publishedAt: i ? null : now, createdAt: now, downloadUrl: '#download'
})))
const userRegisteredAt = '2026-10-24T22:15:00.000Z'
const manyUsers = Array.from({ length: 30 }, (_, i) => ({ id: 100 + i, username: 'player' + String(i).padStart(2, '0'), email: 'player' + i + '@example.test', planSlug: 'medium', isBlocked: false, createdAt: now }))
const users = [{ id: 42, username: 'alex', email: 'alex@example.test', planSlug: 'medium', isBlocked: false, createdAt: userRegisteredAt }, { id: 43, username: 'alexander', email: 'alexander@example.test', planSlug: 'free', isBlocked: false, createdAt: null }]
const probe = { available: true, ok: true, status: 'active', detail: null }
const health = {
    ok: true, checkedAt: now, uptimeSec: 239_400, nodeVersion: 'v24.14.0', platform: 'linux x64', memory: { rssMb: 184, heapUsedMb: 76, heapTotalMb: 96 },
    loadAvg: [.12, .18, .14], db: true, redis: true, siteDist: true, releasesDir: true, env: 'production', recoveryMailConfigured: false,
    pm2: { ...probe, name: 'playtime', restarts: 0, cpuPercent: 1.2, memoryMb: 184, pmUptimeSec: 239_400 },
    nginx: { ...probe, configOk: true, proxyOk: true, proxyStatusCode: 200, proxyLatencyMs: 14 },
    disk: { ...probe, path: '/var/lib/playtime', freeGb: 28.4, totalGb: 40, usedPercent: 29 },
    migrations: { ...probe, applied: 20, pending: 0, latestApplied: '018_password_recovery.sql', latestPending: null }
}
;(async () => {
    await fs.mkdir(output, { recursive: true })
    const browser = await chromium.launch({ headless: true, ...(process.env.ADMIN_BROWSER_PATH ? { executablePath: process.env.ADMIN_BROWSER_PATH } : {}) })
    activeBrowser = browser
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
    const errors = [], mutations = [], external = [], sessionMethods = []
    let mode = 'allowed'
    let failReleases = false
    page.on('pageerror', (error) => {errors.push(error.message);console.error('Page error:',error.message)})
    await page.route('**/*', async (route) => {
        const request = route.request(), url = new URL(request.url())
        if (url.hostname !== new URL(base).hostname && url.protocol !== 'data:') {
            external.push(url.origin)
            return route.abort()
        }
        if (request.resourceType() === 'document' || !['fetch', 'xhr'].includes(request.resourceType())) return route.continue()
        let body
        if (url.pathname.endsWith('/site-analytics/visit')) return route.fulfill({ status: 204 })
        if (url.pathname.endsWith('/admin/access')) return route.fulfill({ status: mode === 'allowed' ? 200 : mode === 'unauthenticated' ? 401 : mode === 'denied' ? 403 : 503, json: { allowed: mode === 'allowed', clientIp: '192.0.2.10' } })
        if (url.pathname.endsWith('/admin/session')) {
            assert.equal(request.method(), 'DELETE')
            assert.equal(request.headers()['x-playtime-admin'], '1')
            sessionMethods.push(request.method())
            mode = 'unauthenticated'
            return route.fulfill({ status: 204 })
        }
        if (mode !== 'allowed') return route.fulfill({ status: mode === 'unauthenticated' ? 401 : mode === 'denied' ? 403 : 503, json: { error: 'Fixture access denied' } })
        if (request.method() !== 'GET') {
            mutations.push({ url: url.pathname, headers: request.headers(), body: request.postDataJSON() })
            assert.equal(request.headers()['x-playtime-admin'], '1')
            if (url.pathname.includes('/admin/releases/')) {
                const release = releases.find((row) => row.id === Number(url.pathname.split('/').pop()))
                const body = request.postDataJSON()
                if (typeof body.release_notes === 'string') release.releaseNotes = body.release_notes
                if (typeof body.is_published === 'boolean') release.isPublished = body.is_published
                return route.fulfill({ json: { release } })
            }
            return route.fulfill({ json: { ok: true, planSlug: 'pro', limits: listPlansPublic()[2].limits } })
        }
        if (url.pathname.endsWith('/admin/stats')) body = { stats: { usersTotal: 1284, adminsTotal: 2, blockedTotal: 12, usersByPlan: [{ plan: 'free', count: 964 }, { plan: 'medium', count: 212 }, { plan: 'pro', count: 96 }, { plan: 'enterprise', count: 12 }], releasesTotal: 8, releasesPublished: 6, latestDownloads: { darwin: { version: '2.0.5', url: '#download', fileSize: 120_586_240, publishedAt: now }, win32: { version: '2.0.5', url: '#download', fileSize: 98_402_304, publishedAt: now } } } }
        else if (url.pathname.endsWith('/admin/health')) body = { health }
        else if (url.pathname.endsWith('/admin/visits')) body = { visits: { today: 128, week: 864, total: 4128, enabledAt: now, timeZone: 'Europe/Moscow', sessionMinutes: 30 } }
        else if (url.pathname.endsWith('/admin/audit')) body = { entries: [{ id: 1, action: 'subscription.change', adminUserId: null, adminUsername: null, targetUserId: 42, targetUsername: 'alex', details: { from: 'free', to: 'pro', clientIp: '192.0.2.10' }, createdAt: now }, { id: 2, action: 'release.publish', adminUserId: null, adminUsername: null, targetUserId: null, targetUsername: null, details: { version: '2.0.5', platform: 'darwin', clientIp: '192.0.2.10' }, createdAt: now }] }
        else if (url.pathname.endsWith('/admin/reports')) body = { reports: [{ id:'1',reporter:'player',reported:'example',reason:'Repeated unwanted calls',created_at:now,resolved_at:null }] }
        else if (url.pathname.endsWith('/admin/releases')) { if (failReleases) return route.fulfill({ status: 503, json: { error: 'Test outage' } }); body = { releases } }
        else if (/\/admin\/users\/\d+\/subscription$/.test(url.pathname)) body = { userId: 42, planSlug: 'medium', limits: listPlansPublic()[1].limits, isBlocked: false }
        else if (url.pathname.endsWith('/admin/users')) body = { users: url.searchParams.get('query') === 'not-found' ? [] : url.searchParams.get('query') === 'many-users' ? manyUsers : users }
        else if (url.pathname.endsWith('/subscription/plans')) body = { plans: listPlansPublic() }
        else return route.fulfill({ status: 404, json: { error: 'Unmocked API route' } })
        return route.fulfill({ json: body })
    })
    const pages = [['panel', 'overview'], ['people', 'users'], ['release-panel', 'releases'], ['plans', 'plans'], ['activity', 'audit'], ['system', 'system'], ['report-panel','reports']]
    for (const [width, height, device] of [[1440, 1000, 'desktop'], [1024, 900, 'tablet'], [390, 844, 'mobile']]) {
        await page.setViewportSize({ width, height })
        for (const [route, name] of pages) {
            console.log('Checking',route,width)
            await page.goto(`${base}/admin/${route}`)
            await page.getByRole('heading', { level: 1 }).waitFor()
            if (route === 'panel') await page.getByText('1284', { exact: true }).waitFor()
            if (route === 'people') {
                await page.getByRole('textbox', { name: 'Поиск пользователей по нику или email' }).fill('alex')
                await page.getByRole('button', { name: 'Найти', exact: true }).click()
                await page.getByRole('button', { name: /alex alex@example.test/ }).click()
                await page.getByText('Сохранить тариф', { exact: true }).waitFor()
                const detail = page.getByRole('region', { name: 'Настройки выбранного пользователя' })
                const registered = detail.getByText(/Дата регистрации/)
                assert.match(await registered.innerText(), /Дата регистрации 25 октября 2026/)
                assert.equal(await registered.locator('time').getAttribute('datetime'), userRegisteredAt)
            }
            if (route === 'system') await page.getByText('SMTP не настроен', { exact: true }).waitFor()
            await page.waitForTimeout(160)
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
            assert.equal(overflow, false, `${name} overflows at ${width}px`)
            await page.screenshot({ path: path.join(output, `${name}-${device}.png`), fullPage: true })
            if (route === 'people' && device === 'mobile') {
                await page.getByRole('button', { name: /alexander alexander@example.test/ }).click()
                const detail = page.getByRole('region', { name: 'Настройки выбранного пользователя' })
                await detail.getByRole('heading', { name: 'alexander', exact: true }).waitFor()
                assert.equal(await detail.getByText(/Дата регистрации/).innerText(), 'Дата регистрации —')
                assert.equal(await detail.locator('time').count(), 0)
            }
            if (route === 'people' && device === 'desktop') {
                await page.getByRole('textbox', { name: 'Поиск пользователей по нику или email' }).fill('many-users')
                await page.getByRole('button', { name: 'Найти', exact: true }).click()
                await page.getByRole('button', { name: /player00 player0@example.test/ }).click()
                await page.getByRole('button', { name: 'Сохранить тариф', exact: true }).waitFor()
                assert.equal(await page.getByRole('region', { name: 'Список аккаунтов' }).evaluate((el) => el.scrollHeight > el.clientHeight), true)
                await page.screenshot({ path: path.join(output, 'users-long-list-desktop.png'), fullPage: true })
            }
            if (route === 'release-panel') {
                await page.getByRole('tab', { name: /Windows/ }).click()
                await page.screenshot({ path: path.join(output, `releases-windows-${device}.png`), fullPage: true })
                await page.getByRole('button', { name: 'Редактировать', exact: true }).first().click()
                await page.screenshot({ path: path.join(output, `release-edit-${device}.png`), fullPage: true })
                await page.getByRole('textbox', { name: /Описание версии/ }).fill('Проверено редактирование описания версии: ' + device)
                await page.getByRole('button', { name: 'Сохранить описание', exact: true }).click()
                await page.getByRole('status').waitFor()
            }
        }
        if (device === 'mobile') {
            await page.getByRole('button', { name: 'Меню', exact: true }).click()
            assert.equal(await page.getByRole('button', { name: 'Меню', exact: true }).getAttribute('aria-expanded'), 'true')
            await page.screenshot({ path: path.join(output, 'navigation-mobile.png') })
            await page.keyboard.press('Escape')
            assert.equal(await page.getByRole('button', { name: 'Меню', exact: true }).getAttribute('aria-expanded'), 'false')
        }
    }
    for (const state of ['unauthenticated', 'denied', 'unavailable']) {
        mode = state
        await page.goto(`${base}/admin`)
        await page.getByRole('heading', { name: state === 'unavailable' ? 'Сервер недоступен' : 'Доступ ограничен' }).waitFor()
        assert.equal(await page.locator('input, textarea, form').count(), 0)
        assert.equal(await page.getByRole('button', { name: 'Скопировать команду' }).count(), 0)
        assert.doesNotMatch(await page.locator('main').innerText(), /(?<!\p{L})(?:ключ|консол|DevTools|Console|команд|инструмент)/iu)
        await page.screenshot({ path: path.join(output, `${state}-mobile.png`), fullPage: true })
    }
    mode = 'allowed'
    await page.goto(`${base}/admin/people`)
    await page.getByRole('textbox', { name: 'Поиск пользователей по нику или email' }).fill('alex')
    await page.getByRole('button', { name: 'Найти', exact: true }).click()
    await page.getByRole('button', { name: /alex alex@example.test/ }).click()
    await page.locator('select').selectOption('pro')
    await page.getByRole('button', { name: 'Сохранить тариф', exact: true }).click()
    await page.waitForTimeout(150)
    assert.ok(mutations.some((entry) => entry.body.plan_slug === 'pro'))
    await page.getByRole('textbox', { name: 'Поиск пользователей по нику или email' }).fill('not-found')
    await page.getByRole('button', { name: 'Найти', exact: true }).click()
    await page.getByText('Пользователи не найдены. Попробуйте другой запрос.').waitFor()
    await page.screenshot({ path: path.join(output, 'users-empty-mobile.png'), fullPage: true })
    failReleases = true
    await page.goto(`${base}/admin/release-panel`)
    await page.getByRole('alert').waitFor()
    await page.screenshot({ path: path.join(output, 'releases-error-mobile.png'), fullPage: true })
    assert.ok(mutations.some((entry) => typeof entry.body.release_notes === 'string'))
    await page.getByRole('button', { name: 'Меню', exact: true }).click()
    await page.getByRole('button', { name: 'Выйти из панели', exact: true }).click()
    await page.getByRole('heading', { name: 'Доступ ограничен' }).waitFor()
    assert.deepEqual(sessionMethods, ['DELETE'])
    await page.goto(`${base}/admin/panel`)
    await page.getByText('Доступ к панели ограничен.', { exact: true }).waitFor()
    assert.equal(await page.getByRole('link', { name: 'Перейти ко входу' }).count(), 1)
    assert.deepEqual(external, [])
    assert.deepEqual(errors, [])
    await browser.close()
    console.log(JSON.stringify({ pages: pages.length, widths: [1440, 1024, 390], screenshots: output, mutations: mutations.length, pageErrors: errors.length, external, sessionMethods }))
})().catch(async (error) => { console.error(error); await activeBrowser?.close(); process.exitCode = 1 })
