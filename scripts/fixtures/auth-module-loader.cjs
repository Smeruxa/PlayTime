const fs = require("node:fs")
const path = require("node:path")
const { createRequire } = require("node:module")
const ts = require("typescript")

const root = path.resolve(__dirname, "../..")

function loadAuthModules(replacements, logger = console) {
    const cache = new Map()

    function load(file) {
        const key = path.relative(root, file).split(path.sep).join("/")
        if (Object.hasOwn(replacements, key)) return replacements[key]
        if (cache.has(file)) return cache.get(file).exports
        const module = { exports: {} }
        cache.set(file, module)
        const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 }
        }).outputText
        const scopedRequire = createRequire(file)
        const request = (id) => {
            if (Object.hasOwn(replacements, id)) return replacements[id]
            if (id.startsWith(".")) {
                const target = path.resolve(path.dirname(file), id)
                const local = [target, target + ".ts", path.join(target, "index.ts")].find(
                    (name) => fs.existsSync(name) && fs.statSync(name).isFile()
                )
                if (local?.endsWith(".ts")) return load(local)
            }
            return scopedRequire(id)
        }
        new Function("require", "module", "exports", "console", source)(request, module, module.exports, logger)
        return module.exports
    }

    return (file) => load(path.resolve(root, file))
}

function findRouteHandler(router, route) {
    for (const layer of router.stack) {
        if (layer.route?.path === route) return layer.route.stack.at(-1).handle
        if (Array.isArray(layer.handle.stack)) {
            const handler = findRouteHandler(layer.handle, route)
            if (handler) return handler
        }
    }
}

module.exports = { loadAuthModules, findRouteHandler }
