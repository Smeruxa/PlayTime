const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const ts = require('typescript')
const { once } = require('node:events')
const root = path.resolve(__dirname, '../..')
const backendRequire = createRequire(path.join(root, 'apps/package.json'))
const express = backendRequire('express')
require('tsx/cjs')
const { recoveryCodeHash } = require('../../apps/auth-api/auth/recoveryCode.ts')

async function fixture(t, { expired = false, issuedCode = '012345' } = {}) {
    let row = { user_id: 42, code_hash: recoveryCodeHash(issuedCode, 'test-secret'), attempts: 0 }
    let passwordHash = null, revoked = 0
    const client = { async query(sql, args = []) {
        if (sql.startsWith('SELECT id FROM users')) return { rows: args[0] === 'alex@example.test' ? [{ id: 42 }] : [] }
        if (sql.includes('SELECT r.user_id')) return { rows: row && !expired && args[0] === 'alex@example.test' ? [{ ...row }] : [] }
        if (sql.startsWith('UPDATE password_recovery')) row.attempts++
        if (sql.startsWith('UPDATE users')) passwordHash = args[0]
        if (sql.startsWith('DELETE FROM password_recovery')) row = null
        return { rows: [] }
    }, release() {} }
    const replacements = {
        '../../shared/config': { pool: { connect: async () => client }, redis: {}, JWT_SECRET: 'test-secret' },
        '../services/recoveryMail': { isRecoveryMailConfigured: () => false },
        '../../shared/auth/passwordPolicy': require('../../apps/shared/auth/passwordPolicy.ts'),
        '../auth/recoveryCode': require('../../apps/auth-api/auth/recoveryCode.ts'),
        '../auth/emailCodeLimits': { createEmailCodeLimits: () => ({ async canTry() { return true }, async recordFailure() {} }) },
        '../admin/revokeUserSessions': { revokeUserSessions: async () => { revoked++ } },
        '../auth/sessionVersion': { revokeUserCredentials: async () => { revoked++ } },
        '../auth/refreshToken': { revokeAllRefreshTokensForUser: async () => { revoked++ } },
        'express-rate-limit': { __esModule: true, default: () => (_req, _res, next) => next() },
        'rate-limit-redis': { RedisStore: class {} }
    }
    const filename = path.join(root, 'apps/auth-api/routes/accountRecovery.ts')
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2020 } }).outputText
    const loaded = { exports: {} }
    new Function('require', 'module', 'exports', code)((name) => Object.hasOwn(replacements, name) ? replacements[name] : backendRequire(name), loaded, loaded.exports)
    const app = express()
    app.use(express.json())
    app.use('/auth', loaded.exports.default)
    const server = app.listen(0, '127.0.0.1')
    await once(server, 'listening')
    t.after(() => new Promise((resolve) => server.close(resolve)))
    const post = async (route, body) => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/auth/recovery/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        return { status: response.status, body: await response.json() }
    }
    return { post, reset: (code = issuedCode) => post('reset', { email: 'alex@example.test', code, password: 'a-new-account-password' }), get state() { return { passwordHash, revoked } } }
}

test('a recovery code resets the password, revokes sessions and cannot be replayed', async (t) => {
    const f = await fixture(t)
    assert.equal((await f.reset()).status, 200)
    assert.equal(await backendRequire('bcrypt').compare('a-new-account-password', f.state.passwordHash), true)
    assert.ok(f.state.revoked > 0)
    assert.equal((await f.reset()).status, 400)
})
test('five wrong attempts invalidate the recovery code', async (t) => {
    const f = await fixture(t)
    for (let i = 0; i < 5; i++) assert.equal((await f.reset('000000')).status, 400)
    assert.equal((await f.reset()).status, 400)
    assert.equal(f.state.passwordHash, null)
    assert.equal(f.state.revoked, 0)
})
test('legacy codes finish only a matching pending hash and retain expiry and one-use limits', async (t) => {
    const legacy = 'ABCDEF1234'
    const f = await fixture(t, { issuedCode: legacy })
    assert.equal((await f.reset('012345')).status, 400)
    assert.equal((await f.reset(legacy.toLowerCase())).status, 200)
    assert.equal((await f.reset(legacy)).status, 400)
    const expired = await fixture(t, { issuedCode: legacy, expired: true })
    assert.equal((await expired.reset(legacy)).status, 400)
})
test('malformed new codes cannot change account credentials', async (t) => {
    const f = await fixture(t)
    for (const code of ['12a345', '12345', '1234567', '１２３４５６']) {
        assert.equal((await f.reset(code)).status, 400)
    }
    assert.equal(f.state.passwordHash, null)
    assert.equal(f.state.revoked, 0)
    assert.equal((await f.reset()).status, 200)
})
test('an expired code cannot reset the password, and absent SMTP is explicit', async (t) => {
    const f = await fixture(t, { expired: true })
    assert.equal((await f.reset()).status, 400)
    assert.equal((await f.post('request', { email: 'alex@example.test' })).status, 503)
    assert.equal(f.state.passwordHash, null)
})

test('SMTP transport delivers the recovery code to a local test mail server', async (t) => {
    const net = require('node:net')
    let message = ''
    const server = net.createServer((socket) => {
        socket.write('220 localhost SMTP test\r\n')
        let buffer = '', data = false
        socket.on('data', (chunk) => {
            buffer += chunk.toString()
            while (buffer.includes('\r\n')) {
                const end = buffer.indexOf('\r\n'), line = buffer.slice(0, end)
                buffer = buffer.slice(end + 2)
                if (data) {
                    if (line === '.') { data = false; socket.write('250 queued\r\n') }
                    else message += line + '\n'
                } else if (line.startsWith('EHLO') || line.startsWith('HELO')) socket.write('250 localhost\r\n')
                else if (line.startsWith('DATA')) { data = true; socket.write('354 send message\r\n') }
                else if (line.startsWith('QUIT')) { socket.end('221 bye\r\n') }
                else socket.write('250 OK\r\n')
            }
        })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    t.after(() => new Promise((resolve) => server.close(resolve)))
    process.env.NODE_ENV = 'test'
    process.env.SMTP_HOST = '127.0.0.1'
    process.env.SMTP_PORT = String(server.address().port)
    process.env.SMTP_FROM = 'PlayTime <test@example.test>'
    delete process.env.SMTP_USER
    const { sendRecoveryMail } = require('../../apps/auth-api/services/recoveryMail.ts')
    await sendRecoveryMail('alex@example.test', '012345')
    assert.match(message, /alex@example.test/)
    const decoded = /Content-Transfer-Encoding: base64/i.test(message) ? Buffer.from(message.split("\n\n").slice(1).join("\n\n"), "base64").toString("utf8") : message
    assert.match(decoded, /012345/)
})
