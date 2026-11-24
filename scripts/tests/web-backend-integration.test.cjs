const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { once } = require('node:events')
const { createRequire } = require('node:module')
const exec = promisify(execFile)
const root = path.resolve(__dirname, '../..')
const backendRequire = createRequire(path.join(root, 'apps/package.json'))
const proof = () => crypto.randomBytes(32).toString('hex')
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function eventually(check, label, timeout = 15000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) { if (await check()) return; await delay(30) }
    throw new Error(`Timed out: ${label}`)
}

async function infrastructure(t) {
    const docker = async (...args) => (await exec('docker', args, { timeout: 60000 })).stdout.trim()
    const endpoint = await docker('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}')
    assert.match(endpoint, /^unix:\/\//, 'Integration tests require a local Docker daemon, never a remote host')
    const suffix = crypto.randomBytes(6).toString('hex')
    const names = [`playtime-qa-pg-${suffix}`, `playtime-qa-redis-${suffix}`]
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'playtime-backend-qa-'))
    const password = crypto.randomBytes(24).toString('hex')
    const freePort = async () => {
        const listener = require('node:net').createServer()
        listener.listen(0, '127.0.0.1'); await once(listener, 'listening')
        const value = listener.address().port
        await new Promise(resolve => listener.close(resolve))
        return value
    }
    const [pgPort, redisPort] = await Promise.all([freePort(), freePort()])
    const containers = []
    let pool, redis, server
    const idlePoolErrors = []
    t.after(async () => {
        if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
        await Promise.allSettled([pool?.end(), redis?.quit()])
        await Promise.allSettled(containers.map(id => docker('rm', '-f', id)))
        await fs.rm(temp, { recursive: true, force: true })
    })
    containers.push(await docker('run', '--rm', '-d', '--name', names[0], '--label', 'playtime.qa=auth-integration', '-p', `127.0.0.1:${pgPort}:5432`, '-e', 'POSTGRES_USER=playtime_test', '-e', 'POSTGRES_DB=playtime_test', '-e', `POSTGRES_PASSWORD=${password}`, 'postgres:15-alpine'))
    containers.push(await docker('run', '--rm', '-d', '--name', names[1], '--label', 'playtime.qa=auth-integration', '-p', `127.0.0.1:${redisPort}:6379`, 'redis:7-alpine', 'redis-server', '--save', '', '--appendonly', 'no', '--requirepass', password))
    const port = async (container, target) => Number(await docker('inspect', '--format', `{{(index (index .NetworkSettings.Ports "${target}/tcp") 0).HostPort}}`, container))
    assert.deepEqual(await Promise.all([port(containers[0], 5432), port(containers[1], 6379)]), [pgPort, redisPort])
    await fs.writeFile(path.join(temp, 'empty.env'), '')
    Object.assign(process.env, { NODE_ENV: 'test', DOTENV_CONFIG_PATH: path.join(temp, 'empty.env'), PG_HOST: '127.0.0.1', PG_PORT: String(pgPort), PG_USER: 'playtime_test', PG_DATABASE: 'playtime_test', PG_PASSWORD: password, PG_STATEMENT_TIMEOUT_MS: '5000', REDIS_URL: `redis://:${password}@127.0.0.1:${redisPort}/0`, JWT_SECRET_ENV: 'isolated-auth-integration-secret-never-production-123456789', REFRESH_TOKEN_TTL_DAYS: '30', SMTP_HOST: 'isolated-mail-fixture', SMTP_FROM: 'PlayTime <qa@example.test>' })
    require('tsx/cjs')
    const config = require('../../apps/shared/config.ts')
    pool = config.pool; redis = config.redis
    pool.on('error', error => idlePoolErrors.push(error.code || error.name))
    redis.on('error', () => {})
    await eventually(async () => { try { await pool.query('SELECT 1'); return true } catch { return false } }, 'PostgreSQL readiness')
    await eventually(async () => { try { return await redis.ping() === 'PONG' } catch { return false } }, 'Redis readiness')
    const mails = []
    const mailFile = path.join(root, 'apps/auth-api/services/recoveryMail.ts')
    require.cache[mailFile] = { id: mailFile, filename: mailFile, loaded: true, exports: { isRecoveryMailConfigured: () => true, async sendRecoveryMail(email, code, kind) { mails.push({ email, code, kind }) } } }
    const express = backendRequire('express')
    const app = express()
    app.use(express.json())
    app.use((req, res, next) => {
        if (req.get('x-test-drop-response') === '1') res.json = () => { req.socket.destroy(); return res }
        next()
    })
    const post = async (route, body, token, drop = false) => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/auth/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(drop ? { 'x-test-drop-response': '1' } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
        return { status: response.status, body: await response.json() }
    }
    return {
        pool, redis, mails, config, temp, app, post, idlePoolErrors,
        async restartServices() {
            await Promise.all(containers.map(id => docker('restart', '--time', '2', id)))
            assert.deepEqual(await Promise.all([port(containers[0], 5432), port(containers[1], 6379)]), [pgPort, redisPort], 'Restart must retain the fixed test endpoints')
            await eventually(async () => { try { await pool.query('SELECT 1'); return true } catch { return false } }, 'PostgreSQL restart recovery')
            await eventually(async () => { try { return await redis.ping() === 'PONG' } catch { return false } }, 'Redis restart recovery')
        },
        async start() {
            for (const name of ['auth', 'emailVerification', 'accountRecovery']) app.use('/auth', require(path.join(root, `apps/auth-api/routes/${name}.ts`)).default)
            server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
        },
        async guest(name) {
            await redis.flushdb()
            const requestKey = proof(), result = await post('guest', { username: name, requestKey })
            assert.equal(result.status, 200, JSON.stringify(result.body))
            return { ...result.body, requestKey }
        }
    }
}

async function applySql(pool, file) {
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        await client.query(await fs.readFile(path.join(root, 'apps/database/migrations', file), 'utf8'))
        await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [file])
        await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
}

test('real PostgreSQL/Redis web auth migration and race integration', { timeout: 180000 }, async t => {
    const f = await infrastructure(t)
    const checks = []
    await t.test('upgrading a legacy schema backfills email destinations and repeated migrations are safe', async () => {
        const schema = (await fs.readFile(path.join(root, 'apps/database/schema.sql'), 'utf8')).replace(/^.*(?:is_guest|guest_registration_pending).*\n/gm, '')
        await f.pool.query(schema)
        const files = (await fs.readdir(path.join(root, 'apps/database/migrations'))).filter(file => file.endsWith('.sql')).sort()
        for (const file of files.filter(file => file < '029')) await applySql(f.pool, file)
        const id = (await f.pool.query("INSERT INTO users(username,email,password_hash,email_verified_at) VALUES('legacy_user','legacy@example.test','test-only-hash',NULL) RETURNING id")).rows[0].id
        for (const table of ['email_verification_codes', 'password_recovery']) await f.pool.query(`INSERT INTO ${table}(user_id,code_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL '15 minutes')`, [id, 'a'.repeat(64)])
        const { runPendingMigrations } = require('../../apps/database/runMigrations.ts')
        await runPendingMigrations()
        await runPendingMigrations()
        assert.ok(files.includes('030_retryable_auth.sql'), 'Retry-safe auth migration must be present')
        for (const table of ['email_verification_codes', 'password_recovery']) {
            assert.equal((await f.pool.query(`SELECT email FROM ${table} WHERE user_id=$1`, [id])).rows[0].email, 'legacy@example.test')
            await assert.rejects(f.pool.query(`INSERT INTO ${table}(user_id,code_hash,expires_at) VALUES($1,$2,NOW())`, [id, 'b'.repeat(64)]), error => error.code === '23502')
        }
        const count = (await f.pool.query('SELECT COUNT(*)::int AS count FROM schema_migrations')).rows[0].count
        assert.equal(count, files.length)
        checks.push('legacy migration/backfill/repeated startup')
    })
    await t.test('fresh schema plus every migration also installs successfully', async () => {
        await f.pool.query('CREATE DATABASE playtime_fresh_test TEMPLATE template0')
        const { Client } = backendRequire('pg')
        const { applyPendingMigrations } = require('../../apps/database/migrationPlan.ts')
        const options = f.pool.options
        const client = new Client({ ...options, password: options.password, database: 'playtime_fresh_test' })
        try {
            await client.connect()
            await client.query('SET search_path = public, pg_temp')
            await client.query(await fs.readFile(path.join(root, 'apps/database/schema.sql'), 'utf8'))
            await applyPendingMigrations(client, path.join(root, 'apps/database/migrations'))
            const { rows } = await client.query(`
                SELECT to_regclass('public.auth_guest_receipts') IS NOT NULL AS guest_receipts,
                    EXISTS (
                        SELECT 1 FROM pg_catalog.pg_trigger
                        WHERE tgrelid = 'public.room_members'::regclass
                            AND tgname = 'rotate_room_membership_key'
                            AND NOT tgisinternal
                    ) AS key_rotation
            `)
            assert.deepEqual(rows[0], { guest_receipts: true, key_rotation: true })
        } finally { await client.end() }
        checks.push('fresh install')
    })
    await t.test('rolling migrations preserve the previous runtime schema and privileges', async () => {
        await f.pool.query('CREATE DATABASE playtime_rolling_test TEMPLATE template0')
        const { Client } = backendRequire('pg')
        const { applyPendingMigrations } = require('../../apps/database/migrationPlan.ts')
        const { applyRollingMigrations } = require('../../apps/database/rollingMigrations.ts')
        const { grantLocalRuntimePrivileges } = require('../../apps/database/localRoles.ts')
        const options = { ...f.pool.options, password: f.pool.options.password, database: 'playtime_rolling_test' }
        const [owner, oldAuth, oldChat, oldGateway, newGateway] = Array.from({ length: 5 }, () => new Client(options))
        const directory = path.join(f.temp, 'rolling-migrations')
        const source = path.join(root, 'apps/database/migrations')
        const migration = '036_auth_session_notifications.sql'
        const tail = path.join(directory, migration)
        const unreviewed = path.join(directory, '038_remove_live_column.sql')
        const roleNames = {
            auth: 'rolling_test_auth', chat: 'rolling_test_chat', gateway: 'rolling_test_gateway', room: 'rolling_test_room'
        }
        try {
            await Promise.all([owner, oldAuth, oldChat, oldGateway, newGateway].map(client => client.connect()))
            await fs.mkdir(directory)
            const files = (await fs.readdir(source)).filter(file => file.endsWith('.sql') && file < migration)
            files.push('037_media_quota_usage.sql')
            await Promise.all(files.map(file => fs.copyFile(path.join(source, file), path.join(directory, file))))
            await owner.query(await fs.readFile(path.join(root, 'apps/database/schema.sql'), 'utf8'))
            await applyPendingMigrations(owner, directory)
            for (const role of Object.values(roleNames)) await owner.query(`CREATE ROLE ${role} NOLOGIN`)
            await grantLocalRuntimePrivileges(owner, roleNames)
            await owner.query('GRANT SELECT (profile_status) ON public.users TO rolling_test_gateway')
            await oldAuth.query('SET ROLE rolling_test_auth')
            await oldChat.query('SET ROLE rolling_test_chat')
            await oldGateway.query('SET ROLE rolling_test_gateway')
            await newGateway.query('SET ROLE rolling_test_gateway')
            await newGateway.query('LISTEN playtime_auth_session_changes')

            const createUser = async username => (await oldAuth.query(
                'INSERT INTO users(username,email,password_hash,email_verified_at) VALUES($1,$2,$3,NULL) RETURNING id',
                [username, `${username}@example.test`, 'test-only']
            )).rows[0].id
            const [sender, receiver] = [await createUser('old_alice'), await createUser('old_bob')]
            const sendMessage = content => oldChat.query(
                'INSERT INTO messages(sender_id,receiver_id,content) VALUES($1,$2,$3) RETURNING id',
                [sender, receiver, content]
            )
            const previousRead = { name: 'existing-runtime-query', text: 'SELECT profile_status FROM users WHERE id=$1', values: [sender] }
            const assertNotApplied = async () => {
                const { rows: [result] } = await owner.query(
                    `SELECT to_regprocedure('public.notify_auth_session_change()') AS trigger_function,
                        EXISTS (SELECT 1 FROM schema_migrations WHERE version=$1) AS recorded`,
                    [migration]
                )
                assert.deepEqual(result, { trigger_function: null, recorded: false })
            }
            assert.equal((await oldGateway.query(previousRead)).rowCount, 1)
            assert.equal((await sendMessage('before')).rowCount, 1)
            const migrationSql = await fs.readFile(path.join(source, migration), 'utf8')
            await fs.writeFile(tail, migrationSql)
            await fs.writeFile(unreviewed, 'ALTER TABLE messages DROP COLUMN content;')
            await assert.rejects(applyRollingMigrations(owner, directory, roleNames), /unreviewed migrations: 038/)
            await assertNotApplied()
            await fs.unlink(unreviewed)

            await fs.writeFile(tail, `${migrationSql}\n`)
            await assert.rejects(applyRollingMigrations(owner, directory, roleNames), /unreviewed migrations: 036/)
            await assertNotApplied()
            await fs.writeFile(tail, migrationSql)

            await oldAuth.query('BEGIN')
            try {
                await oldAuth.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1', [sender])
                const [, sent] = await Promise.all([
                    assert.rejects(applyRollingMigrations(owner, directory, roleNames), error => error.code === '55P03'),
                    sendMessage('while-migration-waited')
                ])
                assert.equal(sent.rowCount, 1)
                await assertNotApplied()
            } finally {
                await oldAuth.query('ROLLBACK')
            }

            await applyRollingMigrations(owner, directory, roleNames)
            await exec(process.execPath, ['--import', 'tsx', 'database/migrateCluster.ts'], {
                cwd: path.join(root, 'apps'),
                env: {
                    ...process.env,
                    PG_DATABASE: options.database,
                    ...Object.fromEntries(Object.entries(roleNames).map(([role, name]) => [
                        `PLAYTIME_${role.toUpperCase()}_PG_USER`, name
                    ]))
                },
                timeout: 10000
            })
            assert.equal((await oldGateway.query(previousRead)).rowCount, 1)
            assert.equal((await sendMessage('after')).rowCount, 1)
            const [[notification]] = await Promise.all([
                once(newGateway, 'notification', { signal: AbortSignal.timeout(3000) }),
                oldAuth.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1', [sender])
            ])
            assert.deepEqual(JSON.parse(notification.payload), ['user', String(sender)])
            const recorded = await newGateway.query('SELECT version FROM schema_migrations WHERE version=$1', [migration])
            assert.equal(recorded.rowCount, 1)
            const messages = await oldChat.query('SELECT content FROM messages ORDER BY id')
            assert.deepEqual(messages.rows.map(({ content }) => content), ['before', 'while-migration-waited', 'after'])
        } finally {
            await Promise.allSettled([owner, oldAuth, oldChat, oldGateway, newGateway].map(client => client.end()))
        }
        checks.push('rolling migration gate, bounded locks and old/new role compatibility')
    })
    await f.start()
    await t.test('six-digit recovery issuance and legacy pending-row compatibility use real PostgreSQL', async () => {
        const email = 'numeric-otp@example.test'
        const password = 'numeric-otp-password-2026'
        const passwordHash = await backendRequire('bcrypt').hash(password, 12)
        const id = (await f.pool.query("INSERT INTO users(username,email,password_hash,email_verified_at) VALUES('numeric_otp',$1,$2,NOW()) RETURNING id", [email, passwordHash])).rows[0].id
        assert.equal((await f.post('recovery/request', { email })).status, 200)
        await eventually(() => f.mails.some(mail => mail.email === email), 'numeric recovery email')
        const code = f.mails.find(mail => mail.email === email).code
        assert.match(code, /^\d{6}$/)
        const { recoveryCodeHash, matchesRecoveryCode } = require('../../apps/auth-api/auth/recoveryCode.ts')
        const pending = (await f.pool.query('SELECT code_hash FROM password_recovery WHERE user_id=$1', [id])).rows[0]
        assert.equal(matchesRecoveryCode(code, pending.code_hash, f.config.JWT_SECRET), true)
        assert.equal(matchesRecoveryCode(code, pending.code_hash, f.config.JWT_SECRET + ':email-verification'), false)
        for (const invalid of ['12a345', '12345', '1234567', '１２３４５６']) {
            assert.equal((await f.post('recovery/reset', { email, code: invalid, password })).status, 400)
        }
        await f.pool.query("UPDATE password_recovery SET expires_at=NOW()-INTERVAL '1 second' WHERE user_id=$1", [id])
        assert.equal((await f.post('recovery/reset', { email, code, password })).status, 400)
        const legacy = 'ABCDEF1234'
        await f.pool.query("UPDATE password_recovery SET code_hash=$1,expires_at=NOW()+INTERVAL '15 minutes',attempts=0 WHERE user_id=$2", [recoveryCodeHash(legacy, f.config.JWT_SECRET), id])
        assert.equal((await f.post('recovery/reset', { email, code: legacy.toLowerCase(), password })).status, 200)
        assert.equal((await f.post('recovery/reset', { email, code: legacy, password })).status, 400)
        assert.equal((await f.post('login', { email, password })).status, 200)
        checks.push('numeric emailed recovery and legacy pending-row compatibility')
    })
    await t.test('daily account code limits survive a replacement code and cover both confirmation endpoints', async () => {
        const password = 'isolated-code-limit-password'
        const { recoveryCodeHash } = require('../../apps/auth-api/auth/recoveryCode.ts')
        for (const [purpose, table, route, secret] of [
            ['recovery', 'password_recovery', 'recovery/reset', f.config.JWT_SECRET],
            ['verification', 'email_verification_codes', 'email-verification/confirm', f.config.JWT_SECRET + ':email-verification']
        ]) {
            const email = `${purpose}-limit@example.test`
            const id = (await f.pool.query("INSERT INTO users(username,email,password_hash,email_verified_at) VALUES($1,$2,'test-only-hash',NULL) RETURNING id", [purpose + '_limit', email])).rows[0].id
            const prefix = `auth:email-codes:${purpose}:${id}`
            await f.redis.set(`${prefix}:failures`, '14', 'EX', 86400)
            await f.pool.query(`INSERT INTO ${table}(user_id,email,code_hash,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '15 minutes')`, [id, email, recoveryCodeHash('012345', secret)])
            const failure = await f.post(route, { email, code: '000001', password })
            assert.equal(failure.status, 400)
            assert.equal(await f.redis.get(`${prefix}:failures`), '15')
            assert.ok(await f.redis.ttl(`${prefix}:blocked`) >= 43_190)
            await f.pool.query(`UPDATE ${table} SET code_hash=$1, attempts=0 WHERE user_id=$2`, [recoveryCodeHash('054321', secret), id])
            assert.deepEqual(await f.post(route, { email, code: '054321', password }), failure)
            assert.equal(await f.redis.get(`${prefix}:failures`), '15')
            assert.equal((await f.pool.query('SELECT email_verified_at FROM users WHERE id=$1', [id])).rows[0].email_verified_at, null)
        }
        await f.redis.flushdb()
        checks.push('cross-code daily account failure budgets and matching anonymous rejection')
    })
    await t.test('recovery and verification share a bounded daily delivery budget per normalized address', async () => {
        const email = 'delivery-budget@example.test'
        const { createEmailCodeLimits } = require('../../apps/auth-api/auth/emailCodeLimits.ts')
        const limits = createEmailCodeLimits(f.redis, f.config.JWT_SECRET)
        const attempts = await Promise.all(Array.from({ length: 10 }, (_, i) => limits.claimDelivery(i % 2 ? email.toUpperCase() : email)))
        assert.equal(attempts.filter(Boolean).length, 8)
        assert.equal(await limits.claimDelivery('other-address@example.test'), true)
        const id = (await f.pool.query("INSERT INTO users(username,email,password_hash,email_verified_at) VALUES('mail_budget',$1,'test-only-hash',NULL) RETURNING id", [email])).rows[0].id
        const { sendAccountRecoveryEmail } = require('../../apps/auth-api/routes/accountRecovery.ts')
        const { sendEmailVerification } = require('../../apps/auth-api/auth/emailVerification.ts')
        await Promise.all([sendAccountRecoveryEmail({ id, email }), sendEmailVerification(id, email)])
        assert.equal((await f.post('recovery/request', { email })).status, 200)
        assert.equal((await f.post('email-verification/request', { email })).status, 200)
        assert.equal(f.mails.filter(mail => mail.email === email).length, 0)
        assert.equal((await f.pool.query('SELECT user_id FROM password_recovery WHERE user_id=$1 UNION ALL SELECT user_id FROM email_verification_codes WHERE user_id=$1', [id])).rowCount, 0)
        await f.redis.flushdb()
        checks.push('shared destination delivery quota with generic request responses')
    })
    await t.test('registration and guest upgrade report the same conflict for an occupied address', async () => {
        const email = 'occupied-address@example.test', password = 'isolated-registration-password'
        await f.pool.query("INSERT INTO users(username,email,password_hash,email_verified_at) VALUES('occupied_addr',$1,'test-only-hash',NOW())", [email])
        const regular = await f.post('register', { username: 'new_addr', email, password })
        assert.equal(regular.status, 409)
        const guest = await f.guest('guest_conflict')
        assert.deepEqual(await f.post('guest/upgrade', { email, password }, guest.token), regular)
        await f.redis.flushdb()
        checks.push('uniform conflicting email responses for registration and guest upgrade')
    })
    await t.test('a guest response lost after commit is recoverable only with the same request proof', async () => {
        const requestKey = proof(), body = { username: 'lost_guest', requestKey }
        await assert.rejects(f.post('guest', body, undefined, true), /fetch failed|socket|network/i)
        const retry = await f.post('guest', body)
        assert.equal(retry.status, 200, JSON.stringify(retry.body))
        assert.equal((await f.pool.query("SELECT COUNT(*)::int AS count FROM users WHERE username='lost_guest'")).rows[0].count, 1)
        assert.equal((await f.pool.query('SELECT COUNT(*)::int AS count FROM auth_sessions WHERE user_id=$1', [retry.body.user.id])).rows[0].count, 1)
        await f.redis.flushdb()
        assert.notEqual((await f.post('guest', { username: body.username, requestKey: proof() })).status, 200)
        assert.notEqual((await f.post('guest', { username: 'other_username', requestKey })).status, 200)
        const stored = await f.pool.query('SELECT request_key_hash FROM auth_guest_receipts WHERE username=$1', [body.username])
        assert.equal(stored.rows.length, 1)
        assert.equal(stored.rows[0].request_key_hash, hash(requestKey))
        checks.push('lost guest response/proof binding/single identity')
    })
    await t.test('failure inserting the first session rolls back the guest nickname and receipt', async () => {
        await f.redis.flushdb()
        await f.pool.query("CREATE FUNCTION qa_fail_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND username='rollback_guest') THEN RAISE EXCEPTION 'isolated test session failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_session BEFORE INSERT ON auth_sessions FOR EACH ROW EXECUTE FUNCTION qa_fail_session()")
        const body = { username: 'rollback_guest', requestKey: proof() }
        try {
            assert.notEqual((await f.post('guest', body)).status, 200)
            assert.equal((await f.pool.query("SELECT COUNT(*)::int AS count FROM users WHERE username='rollback_guest'")).rows[0].count, 0)
            assert.equal((await f.pool.query('SELECT COUNT(*)::int AS count FROM auth_guest_receipts WHERE request_key_hash=$1', [hash(body.requestKey)])).rows[0].count, 0)
        } finally { await f.pool.query('DROP TRIGGER qa_fail_session ON auth_sessions; DROP FUNCTION qa_fail_session()') }
        assert.equal((await f.post('guest', body)).status, 200)
        checks.push('atomic guest/session rollback')
    })
    await t.test('simultaneous guest requests with one proof create only one account and device session', async () => {
        await f.redis.flushdb()
        const body = { username: 'guest_race', requestKey: proof() }
        const results = await Promise.all(Array.from({ length: 5 }, () => f.post('guest', body)))
        assert.ok(results.every(result => result.status === 200), JSON.stringify(results.map(result => ({ status: result.status, error: result.body.error }))))
        assert.equal(new Set(results.map(result => result.body.user.id)).size, 1)
        assert.equal(new Set(results.map(result => result.body.refreshToken)).size, 1)
        assert.equal((await f.pool.query('SELECT COUNT(*)::int AS count FROM auth_sessions WHERE user_id=$1', [results[0].body.user.id])).rows[0].count, 1)
        checks.push('simultaneous guest proof replay')
    })
    await t.test('refresh lost after commit and simultaneous identical retries return one replacement', async () => {
        const guest = await f.guest('refresh_lost')
        const body = { refreshToken: guest.refreshToken, requestKey: proof() }
        await assert.rejects(f.post('refresh', body, undefined, true), /fetch failed|socket|network/i)
        const retries = await Promise.all(Array.from({ length: 5 }, () => f.post('refresh', body)))
        assert.ok(retries.every(result => result.status === 200), JSON.stringify(retries.map(result => ({ status: result.status, error: result.body.error }))))
        assert.equal(new Set(retries.map(result => result.body.refreshToken)).size, 1)
        const replacement = retries[0].body
        assert.notEqual(replacement.refreshToken, guest.refreshToken)
        assert.equal((await f.pool.query('SELECT refresh_token_hash FROM auth_sessions WHERE user_id=$1', [guest.user.id])).rows[0].refresh_token_hash, hash(replacement.refreshToken))
        assert.notEqual((await f.post('refresh', { ...body, requestKey: proof() })).status, 200)
        const next = await f.post('refresh', { refreshToken: replacement.refreshToken, requestKey: proof() })
        assert.equal(next.status, 200)
        assert.notEqual((await f.post('refresh', body)).status, 200, 'Superseded receipts cannot resurrect an earlier replacement')
        await f.post('revoke', { token: next.body.token, refreshToken: next.body.refreshToken })
        assert.notEqual((await f.post('refresh', body)).status, 200)
        assert.equal((await f.post('tokenValid', { token: next.body.token })).status, 401)
        checks.push('lost refresh response/concurrent replay/supersession/logout')
    })
    await t.test('different concurrent refresh proofs cannot create two active replacements', async () => {
        const guest = await f.guest('refresh_race')
        const results = await Promise.all(Array.from({ length: 5 }, () => f.post('refresh', { refreshToken: guest.refreshToken, requestKey: proof() })))
        assert.equal(results.filter(result => result.status === 200).length, 1)
        assert.ok(results.every(result => [200, 401, 409].includes(result.status)), JSON.stringify(results.map(result => result.status)))
        assert.equal((await f.pool.query('SELECT COUNT(*)::int AS count FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NULL', [guest.user.id])).rows[0].count, 1)
        checks.push('different-proof refresh race')
    })
    await t.test('a refresh receipt write failure rolls back rotation and preserves the original credential', async () => {
        const guest = await f.guest('receipt_fail')
        await f.pool.query("CREATE FUNCTION qa_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated receipt failure'; END $$; CREATE TRIGGER qa_fail_receipt BEFORE INSERT ON auth_refresh_receipts FOR EACH ROW EXECUTE FUNCTION qa_fail_receipt()")
        const body = { refreshToken: guest.refreshToken, requestKey: proof() }
        try {
            assert.notEqual((await f.post('refresh', body)).status, 200)
            assert.equal((await f.pool.query('SELECT refresh_token_hash FROM auth_sessions WHERE user_id=$1', [guest.user.id])).rows[0].refresh_token_hash, hash(guest.refreshToken))
            assert.equal((await f.pool.query('SELECT COUNT(*)::int AS count FROM auth_refresh_receipts WHERE previous_token_hash=$1', [hash(guest.refreshToken)])).rows[0].count, 0)
        } finally { await f.pool.query('DROP TRIGGER qa_fail_receipt ON auth_refresh_receipts; DROP FUNCTION qa_fail_receipt()') }
        assert.equal((await f.post('refresh', body)).status, 200)
        checks.push('atomic refresh/receipt rollback')
    })
    await t.test('expired sessions and changed credential versions cannot be resurrected by receipts', async () => {
        for (const mode of ['expired', 'version']) {
            const guest = await f.guest(`replay_${mode}`), body = { refreshToken: guest.refreshToken, requestKey: proof() }
            assert.equal((await f.post('refresh', body)).status, 200)
            if (mode === 'expired') await f.pool.query("UPDATE auth_sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE user_id=$1", [guest.user.id])
            else await f.pool.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1', [guest.user.id])
            assert.notEqual((await f.post('refresh', body)).status, 200)
            assert.notEqual((await f.post('guest', { username: guest.user.username, requestKey: guest.requestKey })).status, 200)
        }
        checks.push('expired and changed-version receipt rejection')
    })
    await t.test('legacy desktop refresh without a proof still rotates atomically', async () => {
        const guest = await f.guest('legacy_refresh')
        const results = await Promise.all([f.post('refresh', { refreshToken: guest.refreshToken }), f.post('refresh', { refreshToken: guest.refreshToken })])
        assert.deepEqual(results.map(result => result.status).sort(), [200, 401])
        assert.equal((await f.pool.query('SELECT COUNT(*)::int AS count FROM auth_sessions WHERE user_id=$1 AND refresh_token_hash IS NOT NULL', [guest.user.id])).rows[0].count, 1)
        checks.push('legacy desktop atomic refresh')
    })
    await t.test('logout queued behind rotation revokes its replacement even with an expired access token', async () => {
        const guest = await f.guest('logout_race'), requestKey = proof()
        const payload = JSON.parse(Buffer.from(guest.token.split('.')[1], 'base64url').toString())
        payload.exp = Math.floor(Date.now() / 1000) - 60
        const expiredAccess = backendRequire('jsonwebtoken').sign(payload, f.config.JWT_SECRET)
        const blocker = await f.pool.connect()
        let rotated, logout
        try {
            await blocker.query('BEGIN')
            await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [guest.user.id])
            rotated = f.post('refresh', { refreshToken: guest.refreshToken, requestKey })
            await eventually(async () => (await f.pool.query("SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE application_name='playtime' AND wait_event_type='Lock'")).rows[0].count >= 1, 'rotation lock waiter')
            logout = f.post('revoke', { token: expiredAccess, refreshToken: guest.refreshToken, requestKey })
            await eventually(async () => (await f.pool.query("SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE application_name='playtime' AND wait_event_type='Lock'")).rows[0].count >= 2, 'logout lock waiter')
            await blocker.query('COMMIT')
        } finally { await blocker.query('ROLLBACK'); blocker.release() }
        const [rotation, revoked] = await Promise.all([rotated, logout])
        assert.equal(rotation.status, 200)
        assert.equal(revoked.status, 200)
        const stored = (await f.pool.query('SELECT revoked_at,refresh_token_hash FROM auth_sessions WHERE user_id=$1', [guest.user.id])).rows[0]
        assert.ok(stored.revoked_at)
        assert.equal(stored.refresh_token_hash, null)
        assert.equal((await f.post('tokenValid', { token: rotation.body.token })).status, 401)
        assert.notEqual((await f.post('refresh', { refreshToken: guest.refreshToken, requestKey })).status, 200)
        checks.push('logout/rotation race with expired access')
    })
    await t.test('only the matching refresh proof can revoke through a consumed refresh token', async () => {
        const guest = await f.guest('revoke_proof'), requestKey = proof()
        const rotation = await f.post('refresh', { refreshToken: guest.refreshToken, requestKey })
        assert.equal(rotation.status, 200)
        assert.equal((await f.post('revoke', { refreshToken: guest.refreshToken, requestKey: proof() })).status, 200)
        assert.equal((await f.post('tokenValid', { token: rotation.body.token })).status, 200)
        assert.equal((await f.post('revoke', { refreshToken: guest.refreshToken, requestKey })).status, 200)
        assert.equal((await f.post('tokenValid', { token: rotation.body.token })).status, 401)
        checks.push('consumed-token revoke proof binding')
    })
    await t.test('a blocked account cannot regain access using a previously successful receipt', async () => {
        const guest = await f.guest('blocked_replay')
        const body = { refreshToken: guest.refreshToken, requestKey: proof() }
        assert.equal((await f.post('refresh', body)).status, 200)
        await f.pool.query('UPDATE users SET is_blocked=TRUE WHERE id=$1', [guest.user.id])
        assert.notEqual((await f.post('refresh', body)).status, 200)
        checks.push('blocked receipt replay')
    })
    await t.test('real user-row locks serialize email confirmation against address correction', async () => {
        for (const first of ['confirm', 'correct']) {
            const guest = await f.guest(`email_${first}`), oldEmail = `${first}@example.test`, newEmail = `new-${first}@example.test`
            const password = 'registered-account-password'
            assert.equal((await f.post('guest/upgrade', { email: oldEmail, password }, guest.token)).status, 200)
            await eventually(() => f.mails.some(mail => mail.email === oldEmail), 'initial verification mail')
            const code = f.mails.find(mail => mail.email === oldEmail).code
            const blocker = await f.pool.connect()
            let requests
            try {
                await blocker.query('BEGIN')
                await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [guest.user.id])
                const confirm = () => f.post('email-verification/confirm', { email: oldEmail, code })
                const correct = () => f.post('guest/change-email', { email: newEmail, password }, guest.token)
                const primary = (first === 'confirm' ? confirm : correct)()
                await eventually(async () => (await f.pool.query("SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE application_name='playtime' AND wait_event_type='Lock'")).rows[0].count >= 1, 'first user-lock waiter')
                const secondary = (first === 'confirm' ? correct : confirm)()
                await eventually(async () => (await f.pool.query("SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE application_name='playtime' AND wait_event_type='Lock'")).rows[0].count >= 2, 'second user-lock waiter')
                await blocker.query('COMMIT')
                requests = await Promise.all([primary, secondary])
            } finally { await blocker.query('ROLLBACK'); blocker.release() }
            assert.equal(requests[0].status, 200, JSON.stringify(requests))
            assert.ok([400, 409].includes(requests[1].status), JSON.stringify(requests))
            const user = (await f.pool.query('SELECT email,is_guest,email_verified_at FROM users WHERE id=$1', [guest.user.id])).rows[0]
            assert.equal(user.email, first === 'confirm' ? oldEmail : newEmail)
            assert.equal(user.is_guest, first !== 'confirm')
            if (first === 'correct') {
                await eventually(() => f.mails.some(mail => mail.email === newEmail), 'corrected verification mail')
                const freshCode = f.mails.find(mail => mail.email === newEmail).code
                assert.equal((await f.post('email-verification/confirm', { email: newEmail, code })).status, 400)
                assert.equal((await f.post('email-verification/confirm', { email: newEmail, code: freshCode })).status, 200)
            }
        }
        checks.push('confirm/correction row-lock race in both orders')
    })
    await t.test('real Redis command failures abort guest creation and leave the unrotated refresh usable', async () => {
        const { createGuestSession, rotateRefreshSession } = require('../../apps/auth-api/auth/retryableSession.ts')
        const guest = await f.guest('redis_failure'), requestKey = proof()
        await f.redis.acl('SETUSER', 'default', '-ttl', '-set')
        try {
            await assert.rejects(rotateRefreshSession(guest.refreshToken, requestKey, async id => { await f.redis.ttl(`acct_locked:${id}`) }), /NOPERM/)
            await assert.rejects(createGuestSession('redis_orphan', proof(), {}, async () => {
                await f.redis.set('qa:guest-create', '1', 'EX', 60, 'NX')
                return { email: 'redis-orphan@example.test', passwordHash: 'fixture-only' }
            }), /NOPERM/)
            assert.equal((await f.pool.query('SELECT refresh_token_hash FROM auth_sessions WHERE user_id=$1', [guest.user.id])).rows[0].refresh_token_hash, hash(guest.refreshToken))
            assert.equal((await f.pool.query("SELECT COUNT(*)::int AS count FROM users WHERE username='redis_orphan'")).rows[0].count, 0)
        } finally { await f.redis.acl('SETUSER', 'default', '+ttl', '+set') }
        assert.equal((await f.post('refresh', { refreshToken: guest.refreshToken, requestKey })).status, 200)
        checks.push('real Redis command failure rollback')
    })
    await t.test('committed response-lost guest and refresh receipts survive PostgreSQL and Redis restart', async () => {
        await f.redis.flushdb()
        const guestRequest = { username: 'restart_guest', requestKey: proof() }
        await assert.rejects(f.post('guest', guestRequest, undefined, true), /fetch failed|socket|network/i)
        const guestId = (await f.pool.query("SELECT id FROM users WHERE username='restart_guest'")).rows[0].id
        const active = await f.guest('restart_refresh')
        const refreshRequest = { refreshToken: active.refreshToken, requestKey: proof() }
        await assert.rejects(f.post('refresh', refreshRequest, undefined, true), /fetch failed|socket|network/i)
        const committedHash = (await f.pool.query('SELECT refresh_token_hash FROM auth_sessions WHERE user_id=$1', [active.user.id])).rows[0].refresh_token_hash
        await f.redis.set('qa:restart-sentinel', 'memory-only')
        await f.restartServices()
        assert.equal(await f.redis.get('qa:restart-sentinel'), null, 'Redis memory was lost in the restart')
        const [recoveredGuest, recoveredRefresh] = await Promise.all([f.post('guest', guestRequest), f.post('refresh', refreshRequest)])
        assert.equal(recoveredGuest.status, 200, JSON.stringify(recoveredGuest.body))
        assert.equal(recoveredGuest.body.user.id, guestId)
        assert.equal(recoveredRefresh.status, 200, JSON.stringify(recoveredRefresh.body))
        assert.equal(hash(recoveredRefresh.body.refreshToken), committedHash)
        assert.equal(recoveredRefresh.body.user.id, active.user.id)
        assert.equal((await f.post('tokenValid', { token: recoveredRefresh.body.token })).status, 200)
        checks.push('durable guest/refresh receipt recovery after real services restart')
    })
    const report = { passed: checks.length === 21, infrastructure: { postgres: (await f.pool.query('SHOW server_version')).rows[0].server_version, redis: (await f.redis.info('server')).match(/redis_version:(.+)/)?.[1]?.trim(), isolated: true, loopbackOnly: true, externalMail: false, restartIdlePoolErrorsHandled: f.idlePoolErrors.length }, checks }
    if (process.env.WEB_BACKEND_REPORT) await fs.writeFile(process.env.WEB_BACKEND_REPORT, JSON.stringify(report, null, 2) + '\n')
    assert.equal(report.passed, true, "All integration checks must complete")
    console.log(JSON.stringify(report))
})
