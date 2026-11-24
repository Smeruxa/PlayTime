const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { buildSync } = require("esbuild")

const root = path.resolve(__dirname, "../..")
const tests = path.join(root, "scripts", "tests")

function runElectronFixture({ name, prefix, main, renderer, body = "", timeout, env = {} }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    try {
        buildSync({
            entryPoints: [path.join(tests, renderer)],
            outfile: path.join(dir, "renderer.js"),
            bundle: true,
            platform: "browser",
            jsx: "automatic",
            define: { "process.env.NODE_ENV": '"test"' }
        })
        fs.writeFileSync(
            path.join(dir, "index.html"),
            `<!doctype html><html><body>${body}<script src="renderer.js"></script></body></html>`
        )
        fs.writeFileSync(
            path.join(dir, "package.json"),
            JSON.stringify({ name, version: "1.0.0", main: path.join(tests, main) })
        )
        const result = spawnSync(require("electron"), [dir, `--user-data-dir=${path.join(dir, "profile")}`], {
            env: { ...process.env, ...env, PLAYTIME_TEST_ROOT: root, PLAYTIME_TEST_DIR: dir },
            stdio: "inherit",
            timeout
        })
        if (result.error) throw result.error
        return result.status ?? 1
    } finally {
        fs.rmSync(dir, { recursive: true, force: true })
    }
}

module.exports = { runElectronFixture }
