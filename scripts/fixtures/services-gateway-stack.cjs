const assert = require("node:assert/strict")
const { createHash, randomBytes } = require("node:crypto")
const { execFile, spawn } = require("node:child_process")
const { once } = require("node:events")
const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises")
const { createServer: createHttpServer, request: httpRequest } = require("node:http")
const { connect, createServer } = require("node:net")
const { createRequire } = require("node:module")
const { tmpdir } = require("node:os")
const path = require("node:path")
const { setTimeout: delay } = require("node:timers/promises")
const { promisify } = require("node:util")

const execute = promisify(execFile)
const root = path.resolve(__dirname, "../..")
const apps = path.join(root, "apps")
const backendRequire = createRequire(path.join(apps, "package.json"))
const loopback = "127.0.0.1"

async function waitUntil(check, label, timeout = 20000) {
    const deadline = Date.now() + timeout
    let cause
    while (Date.now() < deadline) {
        try {
            const value = await check()
            if (value) return value
        } catch (error) {
            cause = error
        }
        await delay(100)
    }
    throw new Error(`Timed out waiting for ${label}`, { cause })
}

async function availablePorts(count) {
    const servers = Array.from({ length: count }, () => createServer())
    try {
        await Promise.all(servers.map((server) => once(server.listen(0, loopback), "listening")))
        return servers.map((server) => server.address().port)
    } finally {
        await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
    }
}

async function localDocker() {
    const env = { ...process.env }
    delete env.DOCKER_HOST
    const { stdout } = await execute("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], {
        env,
        timeout: 10000
    })
    const endpoint = stdout.trim()
    assert.match(endpoint, /^unix:\/\//, "The gateway test requires a local Docker daemon")
    delete env.DOCKER_CONTEXT
    return async (...args) =>
        (await execute("docker", ["--host", endpoint, ...args], { env, timeout: 60000 })).stdout.trim()
}

async function provisionRuntimeRoles(pool) {
    backendRequire("tsx/cjs")
    const { grantLocalRuntimePrivileges } = backendRequire("./database/localRoles.ts")
    const roleNames = {
        gateway: "playtime_test_gateway",
        auth: "playtime_test_auth",
        chat: "playtime_test_chat",
        room: "playtime_test_room"
    }
    const runtimeEnv = {}
    for (const [scope, name] of Object.entries(roleNames)) {
        const password = randomBytes(24).toString("hex")
        await pool.query(`CREATE ROLE ${name} LOGIN PASSWORD '${password}'`)
        runtimeEnv[scope] = { PG_USER: name, PG_PASSWORD: password }
    }
    const owner = await pool.connect()
    try {
        await grantLocalRuntimePrivileges(owner, roleNames)
        const {
            rows: [privileges]
        } = await owner.query(
            `SELECT has_column_privilege($1, 'users', 'password_hash', 'SELECT') AS chat_reads_password,
                    has_table_privilege($2, 'messages', 'INSERT') AS gateway_writes_messages,
                    has_column_privilege($2, 'users', 'is_blocked', 'UPDATE') AS gateway_blocks_accounts,
                    has_any_column_privilege($3, 'users', 'SELECT') AS room_reads_users`,
            [roleNames.chat, roleNames.gateway, roleNames.room]
        )
        assert.deepEqual(privileges, {
            chat_reads_password: false,
            gateway_writes_messages: false,
            gateway_blocks_accounts: false,
            room_reads_users: false
        })
    } finally {
        owner.release()
    }
    return runtimeEnv
}

async function startIsolatableRelay(t, port) {
    let blocked = false
    const sockets = new Set()
    const server = createServer((incoming) => {
        if (blocked) return incoming.destroy()
        sockets.add(incoming)
        const upstream = connect(port, loopback)
        incoming.on("error", () => upstream.destroy())
        upstream.on("error", () => incoming.destroy())
        incoming.on("close", () => {
            sockets.delete(incoming)
            upstream.destroy()
        })
        upstream.on("close", () => incoming.destroy())
        incoming.pipe(upstream).pipe(incoming)
    })
    await once(server.listen(0, loopback), "listening")
    t.after(async () => {
        for (const socket of sockets) socket.destroy()
        await new Promise((resolve) => server.close(resolve))
    })
    return {
        url: `http://${loopback}:${server.address().port}`,
        cut() {
            blocked = true
            for (const socket of sockets) socket.destroy()
        },
        restore() {
            blocked = false
        }
    }
}

async function startAuthRouter(t, primary, secondary) {
    const ports = { primary, secondary }
    const tunnels = new Set()
    let httpReplica = "primary"
    let relayReplica = "primary"
    let nextSessionFailure
    const server = createHttpServer((req, res) => {
        if (nextSessionFailure?.path === req.url) {
            const { result } = nextSessionFailure
            nextSessionFailure = undefined
            req.resume()
            if (result === "reset") req.socket.destroy()
            else res.writeHead(result).end()
            return
        }
        const replica = httpReplica
        const upstream = httpRequest(
            {
                host: loopback,
                port: ports[replica],
                method: req.method,
                path: req.url,
                headers: req.headers
            },
            (response) => {
                res.writeHead(response.statusCode, { ...response.headers, "x-qa-auth-replica": replica })
                response.pipe(res)
            }
        )
        upstream.on("error", () => {
            if (res.headersSent) res.destroy()
            else res.writeHead(502).end()
        })
        req.pipe(upstream)
    })
    server.on("upgrade", (req, socket, head) => {
        const upstream = connect(ports[relayReplica], loopback)
        tunnels.add(socket)
        socket.on("error", () => upstream.destroy())
        socket.once("close", () => {
            tunnels.delete(socket)
            upstream.destroy()
        })
        upstream.on("error", () => socket.destroy())
        upstream.once("connect", () => {
            const headers = []
            for (let i = 0; i < req.rawHeaders.length; i += 2)
                headers.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`)
            upstream.write([`${req.method} ${req.url} HTTP/${req.httpVersion}`, ...headers, "", ""].join("\r\n"))
            upstream.write(head)
            upstream.pipe(socket).pipe(upstream)
        })
    })
    await once(server.listen(0, loopback), "listening")
    t.after(async () => {
        for (const socket of tunnels) socket.destroy()
        server.closeAllConnections()
        await new Promise((resolve) => server.close(resolve))
    })
    return {
        url: `http://${loopback}:${server.address().port}`,
        selectHttp(replica) {
            assert.ok(ports[replica])
            httpReplica = replica
        },
        selectRelay(replica) {
            assert.ok(ports[replica])
            relayReplica = replica
        },
        failNextSessionRequest(operation, result) {
            assert.ok(operation === "verify" || operation === "check")
            assert.ok(result === "reset" || result === 503 || result === 403)
            nextSessionFailure = { path: `/internal/session/${operation}`, result }
        }
    }
}

async function startInfrastructure(
    t,
    { dualGateway = false, isolateSecondaryRelay, dualAuth = false, dualDomains = false } = {}
) {
    const docker = await localDocker()
    const suffix = randomBytes(6).toString("hex")
    const directory = await mkdtemp(path.join(tmpdir(), "playtime-gateway-"))
    const password = randomBytes(24).toString("hex")
    const internalSecret = randomBytes(32).toString("hex")
    const adminKey = randomBytes(32).toString("base64url")
    const database = "playtime_test"
    const containers = []
    let pool
    const processes = new Map()
    let serviceOutput = ""
    const sockets = []

    async function terminateApp(name, signal) {
        const child = processes.get(name)
        if (!child) return
        processes.delete(name)
        if (child.exitCode !== null || child.signalCode) return
        const exited = once(child, "exit")
        child.kill(signal)
        if (!(await Promise.race([exited, delay(5000, false, { ref: false })]))) {
            process.kill(-child.pid, "SIGKILL")
        }
        return exited
    }

    const stopApp = (name) => terminateApp(name, "SIGTERM")
    const killApp = (name) => terminateApp(name, "SIGKILL")

    t.after(async () => {
        for (const socket of sockets) socket.disconnect()
        await Promise.all([...processes.keys()].map(stopApp))
        await pool?.end()
        await Promise.allSettled(containers.map((id) => docker("rm", "-f", id)))
        await rm(directory, { recursive: true, force: true })
        if (!t.passed && serviceOutput) t.diagnostic(serviceOutput)
    })

    containers.push(
        await docker(
            "run",
            "--rm",
            "-d",
            "--name",
            `playtime-gateway-pg-${suffix}`,
            "-p",
            `${loopback}::5432`,
            "-e",
            `POSTGRES_USER=${database}`,
            "-e",
            `POSTGRES_DB=${database}`,
            "-e",
            `POSTGRES_PASSWORD=${password}`,
            "postgres:15-alpine"
        )
    )
    containers.push(
        await docker(
            "run",
            "--rm",
            "-d",
            "--name",
            `playtime-gateway-redis-${suffix}`,
            "-p",
            `${loopback}::6379`,
            "redis:7-alpine",
            "redis-server",
            "--save",
            "",
            "--appendonly",
            "no",
            "--requirepass",
            password
        )
    )
    containers.push(
        await docker(
            "run",
            "--rm",
            "-d",
            "--name",
            `playtime-gateway-turn-${suffix}`,
            "-p",
            `${loopback}::3478/tcp`,
            "coturn/coturn:4.6.3",
            "-n",
            "--listening-port=3478",
            "--fingerprint",
            "--lt-cred-mech",
            `--user=qa:${password}`,
            "--realm=playtime.test",
            "--no-tls",
            "--no-dtls",
            "--no-cli",
            "--allow-loopback-peers"
        )
    )
    async function mappedPort(id, target) {
        const result = await docker("port", id, `${target}/tcp`)
        assert.match(result, /^127\.0\.0\.1:\d+$/)
        return Number(result.split(":")[1])
    }
    const [pgPort, redisPort, turnPort] = await Promise.all([
        mappedPort(containers[0], 5432),
        mappedPort(containers[1], 6379),
        mappedPort(containers[2], 3478)
    ])
    const turnUrl = `turn:${loopback}:${turnPort}?transport=tcp`
    assert.ok(!dualDomains || dualGateway)
    const portCount = dualDomains ? 8 : dualAuth ? 6 : 4 + Number(dualGateway)
    const [port, authPort, chatPort, roomPort, secondaryPort, authSecondaryPort, chatSecondaryPort, roomSecondaryPort] =
        await availablePorts(portCount)
    const authRouter = dualAuth ? await startAuthRouter(t, authPort, authSecondaryPort) : undefined
    const chatRouter = dualDomains ? await startAuthRouter(t, chatPort, chatSecondaryPort) : undefined
    const roomRouter = dualDomains ? await startAuthRouter(t, roomPort, roomSecondaryPort) : undefined
    const directRelayPorts = { AUTH: authPort, CHAT: chatPort, ROOM: roomPort }
    const secondaryRelay = isolateSecondaryRelay
        ? await startIsolatableRelay(t, directRelayPorts[isolateSecondaryRelay])
        : undefined
    const { Pool } = backendRequire("pg")
    pool = new Pool({
        host: loopback,
        port: pgPort,
        database,
        user: database,
        password,
        connectionTimeoutMillis: 1000
    })
    await waitUntil(async () => (await pool.query("SELECT 1")).rowCount, "PostgreSQL")
    await pool.query(await readFile(path.join(apps, "database", "schema.sql"), "utf8"))

    const envFile = path.join(directory, "test.env")
    await writeFile(envFile, "", { mode: 0o600 })
    const env = {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        DOTENV_CONFIG_PATH: envFile,
        JWT_SECRET_ENV: randomBytes(32).toString("hex"),
        PG_HOST: loopback,
        PG_PORT: String(pgPort),
        PG_DATABASE: database,
        PG_USER: database,
        PG_PASSWORD: password,
        REDIS_URL: `redis://:${password}@${loopback}:${redisPort}/0`,
        LISTEN_HOST: loopback,
        PORT: String(port),
        PLAYTIME_AUTH_PORT: String(authPort),
        PLAYTIME_CHAT_PORT: String(chatPort),
        PLAYTIME_ROOM_PORT: String(roomPort),
        PLAYTIME_INTERNAL_SECRET: internalSecret,

        SITE_ORIGIN: `http://${loopback}:${port}`,
        SKIP_SITE_BUILD: "1",
        WEBRTC_STUN_URLS: `stun:${loopback}:9`,
        WEBRTC_TURN_URL: turnUrl,
        WEBRTC_TURN_USERNAME: "qa",
        WEBRTC_TURN_CREDENTIAL: password,
        RELEASES_DIR: path.join(directory, "releases"),
        VOICE_STORAGE_DIR: path.join(directory, "voice"),
        ATTACHMENT_STORAGE_DIR: path.join(directory, "attachments")
    }
    await execute(process.execPath, ["--import", "tsx", "database/runMigrations.ts"], {
        cwd: apps,
        env,
        timeout: 15000
    })
    const runtimeEnv = await provisionRuntimeRoles(pool)
    const loader = backendRequire.resolve("tsx")
    const applications = new Map([
        ["auth-api", { app: "auth-api", port: authPort }],
        ["chat-api", { app: "chat-api", port: chatPort }],
        ["room-api", { app: "room-api", port: roomPort }],
        ["gateway", { app: "gateway", port, slot: dualGateway || dualAuth ? "primary" : undefined }]
    ])
    if (dualGateway) applications.set("gateway-secondary", { app: "gateway", port: secondaryPort, slot: "secondary" })
    if (dualAuth) applications.set("auth-api-secondary", { app: "auth-api", port: authSecondaryPort })
    if (dualDomains) {
        applications.set("chat-api-secondary", { app: "chat-api", port: chatSecondaryPort })
        applications.set("room-api-secondary", { app: "room-api", port: roomSecondaryPort })
    }

    const relaySecrets = Object.fromEntries(
        ["AUTH", "CHAT", "ROOM"].map((name) => [`PLAYTIME_${name}_RELAY_SECRET`, randomBytes(32).toString("hex")])
    )
    const moderation = { PLAYTIME_MODERATION_SECRET: randomBytes(32).toString("hex") }
    const admin = {
        ADMIN_SESSION_SIGNING_KEY: randomBytes(32).toString("hex"),
        ADMIN_ACCESS_KEY_HASH: createHash("sha256").update(adminKey).digest("hex")
    }

    async function startApp(name) {
        assert.ok(!processes.has(name), `${name} is already running`)
        const config = applications.get(name)
        assert.ok(config, `Unknown application ${name}`)
        const { app, port, slot } = config
        const role = app.replace(/-api$/, "")
        const isGateway = app === "gateway"
        const child = spawn(process.execPath, ["--import", loader, "main.ts"], {
            cwd: path.join(apps, app),
            detached: true,
            env: {
                ...env,
                ...runtimeEnv[role],
                ...(isGateway
                    ? { ...admin, ...moderation, ...relaySecrets, PORT: String(port) }
                    : {
                          [`PLAYTIME_${role.toUpperCase()}_PORT`]: String(port),
                          [`PLAYTIME_${role.toUpperCase()}_RELAY_SECRET`]:
                              relaySecrets[`PLAYTIME_${role.toUpperCase()}_RELAY_SECRET`],
                          ...(app === "auth-api" ? moderation : {})
                      }),
                ...(authRouter ? { PLAYTIME_AUTH_URL: authRouter.url, PLAYTIME_AUTH_HA: "1" } : {}),
                ...(dualDomains
                    ? {
                          PLAYTIME_DOMAIN_ROLLOUT: "1",
                          PLAYTIME_CHAT_URL: chatRouter.url,
                          PLAYTIME_ROOM_URL: roomRouter.url,
                          PLAYTIME_CHAT_RELAY_URLS: `http://${loopback}:${chatPort},http://${loopback}:${chatSecondaryPort}`,
                          PLAYTIME_ROOM_RELAY_URLS: `http://${loopback}:${roomPort},http://${loopback}:${roomSecondaryPort}`
                      }
                    : {}),
                ...(slot ? { PLAYTIME_GATEWAY_SLOT: slot } : {}),
                ...(slot === "secondary" && secondaryRelay
                    ? { [`PLAYTIME_${isolateSecondaryRelay}_URL`]: secondaryRelay.url }
                    : {}),
                SKIP_DB_MIGRATIONS: "1"
            },
            stdio: ["ignore", "pipe", "pipe"]
        })
        processes.set(name, child)
        let spawnError
        child.on("error", (error) => {
            spawnError = error
        })
        for (const stream of [child.stdout, child.stderr]) {
            stream.setEncoding("utf8")
            stream.on("data", (chunk) => {
                serviceOutput = (serviceOutput + `[${name}] ${chunk}`).slice(-16000)
            })
        }
        const baseUrl = `http://${loopback}:${port}`
        const healthUrl = `${baseUrl}${isGateway ? "/playtime/health" : "/internal/health"}`
        const headers = isGateway ? {} : { "x-playtime-internal": internalSecret }
        const health = await waitUntil(async () => {
            if (spawnError) return spawnError
            if (child.exitCode !== null || child.signalCode) {
                return new Error(`${name} exited with ${child.exitCode ?? child.signalCode}`)
            }
            const response = await fetch(healthUrl, { headers, signal: AbortSignal.timeout(1000) })
            if (response.ok) return response.json()
            await response.body?.cancel()
            return false
        }, name)
        if (health instanceof Error) throw health
        assert.equal(health.ok, true, name)
        if (!isGateway) {
            assert.equal(health.service, app)
            assert.equal(health.pid, child.pid)
            const untrusted = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) })
            assert.ok(!untrusted.ok, name)
            await untrusted.body?.cancel()
        }
        return child.pid
    }

    const domainPids = await Promise.all(
        [...applications]
            .filter(([, config]) => config.app !== "gateway")
            .map(([name]) => name)
            .map(startApp)
    )
    const gateways = [...applications]
        .filter(([, config]) => config.app === "gateway")
        .map(([name, config]) => ({ name, slot: config.slot, url: `http://${loopback}:${config.port}` }))
    const gatewayPids = await Promise.all(gateways.map(({ name }) => startApp(name)))
    assert.equal(
        new Set([...domainPids, ...gatewayPids]).size,
        applications.size,
        "Each application runs as a separate process"
    )
    const url = `http://${loopback}:${port}`
    const publicPrivateRoute = await fetch(`${url}/internal/health`, { signal: AbortSignal.timeout(2000) })
    assert.ok(!publicPrivateRoute.ok, "The public gateway does not route internal health")
    await publicPrivateRoute.body?.cancel()
    t.diagnostic("Launched each apps/ entry point separately with restricted PostgreSQL roles")

    return {
        url,
        pool,
        sockets,
        turnUrl,
        startApp,
        stopApp,
        killApp,
        adminKey,
        gateways,
        secondaryRelay,
        authRouter,
        chatRouter,
        roomRouter
    }
}

module.exports = { startInfrastructure, waitUntil }
