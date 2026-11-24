import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import childProcess from "node:child_process"
import { syncBuiltinESMExports } from "node:module"
import path from "node:path"
import { test } from "node:test"
import { findArtifacts, isReactBuildFresh, writePackageVersion, readEnvFile, publishPlatform } from "./release"

function fixture(run: (root: string) => void) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "playtime-release-test-"))
    try {
        run(root)
    } finally {
        fs.rmSync(root, { recursive: true, force: true })
    }
}

test("deployment env accepts quoted identity paths and JSON-escaped values", () =>
    fixture((root) => {
        const file = path.join(root, "profile.conf")
        fs.writeFileSync(file, "DEPLOY_SSH_KEY='/a folder/key'\nVALUE=\"line\\nnext\"\nRAW=plain\n")
        assert.deepEqual(readEnvFile(file), { DEPLOY_SSH_KEY: "/a folder/key", VALUE: "line\nnext", RAW: "plain" })
    }))

test("artifact selection rejects another patch version and requires the mac updater", () =>
    fixture((root) => {
        fs.writeFileSync(path.join(root, "PlayTime-2.0.10.dmg"), "dmg")
        fs.writeFileSync(path.join(root, "PlayTime-2.0.10-Setup.exe"), "exe")
        assert.throws(() => findArtifacts(root, "darwin", "2.0.1"), /No .dmg/)
        assert.throws(() => findArtifacts(root, "win32", "2.0.1"), /No Setup/)
        fs.writeFileSync(path.join(root, "PlayTime-2.0.1-arm64.dmg"), "dmg")
        assert.throws(() => findArtifacts(root, "darwin", "2.0.1"), /No updater/)
        fs.writeFileSync(path.join(root, "PlayTime-2.0.1-arm64-mac.zip"), "zip")
        assert.deepEqual(findArtifacts(root, "darwin", "2.0.1"), {
            primary: "PlayTime-2.0.1-arm64.dmg",
            update: "PlayTime-2.0.1-arm64-mac.zip"
        })
    }))

test("version bump keeps package.json and lockfile metadata in sync", () =>
    fixture((root) => {
        fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "2.0.3" }))
        fs.writeFileSync(
            path.join(root, "package-lock.json"),
            JSON.stringify({ version: "2.0.3", packages: { "": { version: "2.0.3" } } })
        )
        writePackageVersion("2.0.4", root)
        const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
        const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"))
        assert.equal(pkg.version, "2.0.4")
        assert.equal(lock.version, pkg.version)
        assert.equal(lock.packages[""].version, pkg.version)
    }))

test("production env and package changes invalidate the cached React build", () =>
    fixture((root) => {
        fs.mkdirSync(path.join(root, "build"))
        const html = path.join(root, "build/index.html")
        fs.writeFileSync(html, "html")
        fs.utimesSync(html, 100, 100)
        assert.equal(isReactBuildFresh(root), false)
        fs.writeFileSync(path.join(root, "build/incoming-call.html"), "html")
        assert.equal(isReactBuildFresh(root), true)
        const env = path.join(root, ".env.production")
        fs.writeFileSync(env, "REACT_APP_API_BASE=https://example.test")
        assert.equal(isReactBuildFresh(root), false)
        fs.utimesSync(env, 50, 50)
        assert.equal(isReactBuildFresh(root), true)
        fs.writeFileSync(path.join(root, "package.json"), "{}")
        assert.equal(isReactBuildFresh(root), false)
        fs.utimesSync(path.join(root, "package.json"), 50, 50)
        const vite = path.join(root, "vite.config.mts")
        fs.writeFileSync(vite, "export default {}")
        assert.equal(isReactBuildFresh(root), false)
        fs.utimesSync(vite, 50, 50)
        assert.equal(isReactBuildFresh(root), true)
        fs.mkdirSync(path.join(root, "apps/frontend"), { recursive: true })
        fs.writeFileSync(path.join(root, "apps/frontend/index.html"), "<html></html>")
        assert.equal(isReactBuildFresh(root), false)
        fs.utimesSync(path.join(root, "apps/frontend/index.html"), 50, 50)
        fs.writeFileSync(path.join(root, "apps/frontend/incoming-call.html"), "<html></html>")
        assert.equal(isReactBuildFresh(root), false)
    }))

test("files-only staging checks remote bytes over pinned SSH and skips registration", (t) =>
    fixture((root) => {
        const commands: { command: string; args: readonly string[] }[] = []
        t.mock.method(childProcess, "spawnSync", (command: string, args: readonly string[]) => {
            commands.push({ command, args })
            return { status: 0, stdout: "", stderr: "" }
        })
        syncBuiltinESMExports()
        t.after(() => {
            t.mock.restoreAll()
            syncBuiltinESMExports()
        })
        const previousProfile = process.env.PLAYTIME_RELEASE_PROFILE
        const profile = path.join(root, "release-profile")
        process.env.PLAYTIME_RELEASE_PROFILE = profile
        t.after(() => {
            if (previousProfile === undefined) delete process.env.PLAYTIME_RELEASE_PROFILE
            else process.env.PLAYTIME_RELEASE_PROFILE = previousProfile
        })
        fs.writeFileSync(path.join(root, "known_hosts"), "pinned host-key fixture\n", { mode: 0o600 })
        fs.mkdirSync(path.join(root, "dist"))
        fs.writeFileSync(path.join(root, "dist", "PlayTime-2.0.21-Setup.exe"), "installer")
        const common = [
            "DEPLOY_HOST=release.test",
            "DEPLOY_USER=publisher",
            "DEPLOY_SSH_KEY=key",
            "DEPLOY_KNOWN_HOSTS=known_hosts",
            "DEPLOY_REMOTE_PATH=/old"
        ]
        for (const custom of [false, true]) {
            commands.length = 0
            fs.writeFileSync(
                profile,
                [...common, custom ? "DEPLOY_RELEASES_PATH=/cluster/releases" : ""].join("\n")
            )
            publishPlatform({ root, platform: "win32", version: "2.0.21", filesOnly: true })
            assert.deepEqual(
                commands.map((item) => item.command),
                ["ssh", "ssh"]
            )
            assert(
                commands.every(
                    (item) =>
                        item.args.includes("StrictHostKeyChecking=yes") &&
                        item.args.includes("GlobalKnownHostsFile=none") &&
                        item.args.includes(`UserKnownHostsFile="${path.join(root, "known_hosts")}"`)
                )
            )
            const directory = custom ? "/cluster/releases/win32" : "/old/data/releases/win32"
            assert(commands[1].args.at(-1)?.includes(directory + "/PlayTime-2.0.21-Setup.exe"))
        }
    }))
