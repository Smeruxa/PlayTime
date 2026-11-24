import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { test, mock } from "node:test"
import { configureAdminAccess, parseAdminAccessArgs } from "../../apps/gateway/admin/configureAdminAccess"

function fixture(run: (dir: string) => void) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "playtime-admin-setup-test-"))
    try {
        run(dir)
    } finally {
        fs.rmSync(dir, { recursive: true, force: true })
    }
}
function options(dir: string, rotate = false) {
    return { envFile: path.join(dir, "runtime.env"), keyFile: path.join(dir, "admin.key"), rotate }
}
function checkFiles(dir: string) {
    const { envFile, keyFile } = options(dir)
    const key = fs.readFileSync(keyFile, "utf8").trim()
    assert.ok(/^[A-Za-z0-9_-]{43}$/.test(key), "Key is canonical base64url32 bytes")
    assert.equal(Buffer.from(key, "base64url").length, 32)
    const expected = createHash("sha256").update(key).digest("hex")
    const env = fs.readFileSync(envFile, "utf8")
    assert.ok(env.includes(`ADMIN_ACCESS_KEY_HASH=${expected}`), "Stored hash matches encoded key")
    assert.match(env, /^ADMIN_SESSION_SIGNING_KEY=[A-Za-z0-9_-]{43}$/m)
    assert.ok(!env.includes(key), "Raw key never enters env")
    assert.equal(fs.statSync(envFile).mode & 0o777, 0o600)
    assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600)
    assert.deepEqual(fs.readdirSync(dir).sort(), ["admin.key", "runtime.env"])
    return { key, env }
}

test("CLI requires explicit file paths and rejects secret/unknown/duplicate arguments", () => {
    assert.deepEqual(parseAdminAccessArgs(["--env-file", "a", "--key-file", "b", "--rotate"]), {
        envFile: "a",
        keyFile: "b",
        rotate: true
    })
    for (const args of [
        [],
        ["--env-file", "a"],
        ["--key", "not-an-accepted-secret"],
        ["--key-file", "--rotate"],
        ["--env-file", "a", "--env-file", "b", "--key-file", "c"]
    ])
        assert.throws(() => parseAdminAccessArgs(args))
})
test("initial setup preserves other env values and writes private hash/key files", () =>
    fixture((dir) => {
        fs.writeFileSync(
            options(dir).envFile,
            "# keep this\r\nJWT_SECRET_ENV=existing\r\nADMIN_ACCESS_KEY_HASH=\r\nUNCHANGED='value with spaces'\r\n",
            { mode: 0o644 }
        )
        const result = configureAdminAccess(options(dir))
        assert.equal(result.rotated, false)
        const { env } = checkFiles(dir)
        assert.ok(env.startsWith("# keep this\r\nJWT_SECRET_ENV=existing\r\nUNCHANGED='value with spaces'\r\n"))
        assert.equal((env.match(/ADMIN_ACCESS_KEY_HASH=/g) || []).length, 1)
    }))
test("existing raw key or configured hash requires explicit rotation without any writes", () =>
    fixture((dir) => {
        const opts = options(dir)
        fs.writeFileSync(opts.envFile, "OTHER=unchanged\nADMIN_ACCESS_KEY_HASH=existing\n")
        assert.throws(() => configureAdminAccess(opts), /--rotate/)
        assert.equal(fs.existsSync(opts.keyFile), false)
        assert.equal(fs.readFileSync(opts.envFile, "utf8"), "OTHER=unchanged\nADMIN_ACCESS_KEY_HASH=existing\n")
        fs.writeFileSync(opts.envFile, "OTHER=unchanged")
        fs.writeFileSync(opts.keyFile, "previous-private-key\n")
        assert.throws(() => configureAdminAccess(opts), /--rotate/)
        assert.equal(fs.readFileSync(opts.keyFile, "utf8"), "previous-private-key\n")
        assert.deepEqual(fs.readdirSync(dir).sort(), ["admin.key", "runtime.env"])
    }))
test("rotation replaces the secret and all duplicate hash settings, preserving unrelated env", () =>
    fixture((dir) => {
        configureAdminAccess(options(dir))
        const previous = checkFiles(dir)
        fs.appendFileSync(options(dir).envFile, "export ADMIN_ACCESS_KEY_HASH='duplicate'\nOTHER=preserved\n")
        const result = configureAdminAccess(options(dir, true))
        const current = checkFiles(dir)
        assert.equal(result.rotated, true)
        assert.ok(previous.key !== current.key, "Rotation generates a new key")
        assert.equal((current.env.match(/ADMIN_ACCESS_KEY_HASH=/g) || []).length, 1)
        assert.ok(current.env.includes("OTHER=preserved\n"))
    }))
test("CLI never prints key material or preexisting env values", () =>
    fixture((dir) => {
        fs.writeFileSync(options(dir).envFile, "PRIVATE_OTHER=do-not-print-this-value\n")
        const result = execFileSync(
            process.execPath,
            [
                "--import",
                "tsx",
                "--",
                "apps/gateway/admin/configureAdminAccess.ts",
                "--env-file",
                options(dir).envFile,
                "--key-file",
                options(dir).keyFile
            ],
            { cwd: path.resolve(__dirname, "../.."), encoding: "utf8" }
        )
        const { key, env } = checkFiles(dir)
        assert.ok(!result.includes(key), "No raw key in output")
        assert.ok(!result.includes("do-not-print-this-value"), "No env values in output")
        assert.ok(
            !result.includes(env.match(/ADMIN_ACCESS_KEY_HASH=(.+)/)?.[1] || "missing-hash"),
            "No key hash in output"
        )
        assert.match(result, /Restart the backend/)
        assert.match(result, /rotation invalidates existing admin sessions/)
    }))
test("the exact npm command creates a previously missing env file without reparsing --env-file as a Node flag", () =>
    fixture((dir) => {
        const opts = options(dir)
        const output = execFileSync(
            "npm",
            ["run", "admin:key", "--", "--env-file", opts.envFile, "--key-file", opts.keyFile],
            { cwd: path.resolve(__dirname, "../.."), encoding: "utf8" }
        )
        const { key } = checkFiles(dir)
        assert.ok(!output.includes(key), "npm output contains no raw key")
        assert.match(output, /Generated the permanent admin access key/)
    }))

test("same-file aliases, symlinks and hard links are refused", () =>
    fixture((dir) => {
        const opts = options(dir)
        assert.throws(() => configureAdminAccess({ ...opts, keyFile: opts.envFile }), /different files/)
        fs.writeFileSync(path.join(dir, "original"), "keep")
        fs.symlinkSync(path.join(dir, "original"), opts.keyFile)
        assert.throws(() => configureAdminAccess({ ...opts, rotate: true }), /symlinks or hard links/)
        assert.equal(fs.readFileSync(path.join(dir, "original"), "utf8"), "keep")
        fs.unlinkSync(opts.keyFile)
        fs.linkSync(path.join(dir, "original"), opts.keyFile)
        assert.throws(() => configureAdminAccess({ ...opts, rotate: true }), /symlinks or hard links/)
    }))
test("an existing setup lock prevents overwriting and is never removed", () =>
    fixture((dir) => {
        const opts = options(dir),
            lock = `${opts.keyFile}.admin-access.lock`
        fs.writeFileSync(lock, "", { mode: 0o600 })
        assert.throws(() => configureAdminAccess(opts), /lock already exists/)
        assert.equal(fs.existsSync(opts.envFile), false)
        assert.equal(fs.existsSync(lock), true)
    }))
test("a failed env commit restores the previous key and keeps the previous configuration", () =>
    fixture((dir) => {
        const opts = options(dir)
        configureAdminAccess(opts)
        const previous = checkFiles(dir)
        const originalRename = fs.renameSync
        const canonicalEnv = path.join(fs.realpathSync(path.dirname(opts.envFile)), path.basename(opts.envFile))
        const rename = mock.method(fs, "renameSync", (source: fs.PathLike, target: fs.PathLike) => {
            if (target === canonicalEnv) throw new Error("Simulated env commit failure")
            return originalRename(source, target)
        })
        try {
            assert.throws(() => configureAdminAccess({ ...opts, rotate: true }), /Simulated/)
        } finally {
            rename.mock.restore()
        }
        const current = checkFiles(dir)
        assert.ok(current.key === previous.key, "Previous key is restored")
        assert.ok(current.env === previous.env, "Previous env is preserved")
    }))
