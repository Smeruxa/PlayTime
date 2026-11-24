const { test } = require("node:test")
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const path = require("node:path")
const { execFile } = require("node:child_process")
const { promisify } = require("node:util")
const exec = promisify(execFile)
const root = path.resolve(__dirname, "../..")
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test("guest lifecycle uses isolated owned PostgreSQL and Redis containers", { timeout: 120000 }, async () => {
    const containers = []
    const label = `playtime.qa.guest-lifecycle=${crypto.randomBytes(8).toString("hex")}`
    const password = crypto.randomBytes(24).toString("hex")
    const docker = async (...args) => (await exec("docker", args, { timeout: 60000 })).stdout.trim()
    try {
        assert.match(await docker("context", "inspect", "--format", "{{.Endpoints.docker.Host}}"), /^unix:\/\//)
        containers.push(
            await docker(
                "run",
                "--rm",
                "-d",
                "--label",
                label,
                "-p",
                "127.0.0.1::5432",
                "-e",
                "POSTGRES_USER=playtime_test",
                "-e",
                "POSTGRES_DB=guest_lifecycle_test",
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
                "--label",
                label,
                "-p",
                "127.0.0.1::6379",
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
        for (let attempt = 0; ; attempt++) {
            try {
                await docker("exec", containers[0], "pg_isready", "-U", "playtime_test", "-d", "guest_lifecycle_test")
                await docker("exec", containers[1], "redis-cli", "-a", password, "ping")
                break
            } catch (error) {
                if (attempt >= 100) throw error
                await pause(100)
            }
        }
        const port = async (id, target) =>
            Number(
                await docker(
                    "inspect",
                    "--format",
                    `{{(index (index .NetworkSettings.Ports "${target}/tcp") 0).HostPort}}`,
                    id
                )
            )
        const [pgPort, redisPort] = await Promise.all([port(containers[0], 5432), port(containers[1], 6379)])
        const childEnv = { ...process.env }
        delete childEnv.NODE_TEST_CONTEXT
        const result = await exec(
            process.execPath,
            ["--import", "tsx", "--test", "scripts/tests/guest-lifecycle.test.cjs"],
            {
                cwd: root,
                timeout: 60000,
                env: {
                    ...childEnv,
                    NODE_ENV: "test",
                    GUEST_LIFECYCLE_TEST_DATABASE: "isolated",
                    PG_HOST: "127.0.0.1",
                    PG_PORT: String(pgPort),
                    PG_USER: "playtime_test",
                    PG_DATABASE: "guest_lifecycle_test",
                    PG_PASSWORD: password,
                    REDIS_URL: `redis://:${password}@127.0.0.1:${redisPort}/0`,
                    JWT_SECRET_ENV: "isolated-guest-lifecycle-secret-not-production"
                }
            }
        )
        process.stdout.write(result.stdout)
        process.stderr.write(result.stderr)
    } finally {
        for (const id of containers.reverse()) {
            const owned = await docker(
                "inspect",
                "--format",
                '{{index .Config.Labels "playtime.qa.guest-lifecycle"}}',
                id
            )
            assert.equal(owned, label.split("=")[1])
            await docker("rm", "-f", id)
        }
    }
})
