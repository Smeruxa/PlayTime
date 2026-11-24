const { execFileSync } = require("node:child_process")
const { appendFileSync, readFileSync } = require("node:fs")

const services = ["auth-api", "chat-api", "room-api", "gateway"]
const serverScopes = [...services, "shared", "database"]
const applications = [...services, "frontend", "site", "mobile"]
const lanes = ["services", "frontend", "site", "mobile", "android", "archive"]
const dependents = {
    "auth-api": ["gateway", "chat-api"],
    "chat-api": ["gateway", "room-api"],
    "room-api": ["gateway", "chat-api"],
    frontend: ["site", "mobile"]
}

function planForPaths(paths) {
    const affected = new Set()
    let archive = false
    let android = false

    function add(application) {
        if (affected.has(application)) return
        affected.add(application)
        for (const dependent of dependents[application] ?? []) add(dependent)
    }

    function addAll() {
        applications.forEach(add)
        serverScopes.forEach(add)
        android = true
    }

    for (const file of paths ?? [".github/workflows/ci.yml"]) {
        if (file.startsWith(".github/")) {
            addAll()
        } else if (/^(docs\/|.*\.md$)/i.test(file) || ["LICENSE", ".gitignore"].includes(file)) {
            continue
        } else if (/^apps\/(shared\/|package(?:-lock)?\.json$|\.npmrc$)/.test(file)) {
            applications.forEach(add)
            serverScopes.forEach(add)
        } else if (/^apps\/(database\/|tsconfig\.json$)/.test(file)) {
            services.forEach(add)
            add("database")
            if (file === "apps/tsconfig.json") add("shared")
        } else if (/^(scripts\/package-backend\.cjs$|deploy_backend\/|deploy\/k8s\/|Dockerfile$|\.dockerignore$)/.test(file)) {
            archive = true
        } else if (file.startsWith("mobile/")) {
            add("mobile")
            if (/^mobile\/(android\/|scripts\/(?:android|bootstrap-android|format-android)\b|package(?:-lock)?\.json$)/.test(file)) {
                android = true
            }
        } else if (/^(apps\/frontend\/|vite(?:\.web)?\.config\.mts$|index\.html$)/.test(file)) {
            add("frontend")
        } else if (file.startsWith("apps/site/") || file === "scripts/build-web-site.cjs") {
            add("site")
            archive = true
        } else if (file.startsWith("assets/")) {
            add("frontend")
            archive = true
        } else {
            const service = services.find((name) => file.startsWith(`apps/${name}/`))
            if (service) {
                add(service)
                if (file === "apps/gateway/http/serveSite.ts") add("frontend")
                if (/^apps\/chat-api\/utils\/(e2eeWire|dmE2eeEnvelope|roomE2eeEnvelope)\.ts$/.test(file)) add("mobile")
            } else {
                addAll()
            }
        }
    }

    const selected = new Set(affected)
    if (services.some((service) => affected.has(service))) {
        selected.add("services")
        archive = true
    }
    if (affected.has("site")) archive = true
    if (android) selected.add("android")
    if (archive) selected.add("archive")
    return {
        applications: applications.filter((application) => affected.has(application)),
        lanes: lanes.filter((lane) => selected.has(lane)),
        serviceScopes: serverScopes.filter((scope) => affected.has(scope))
    }
}

function changedPaths(eventName, event) {
    const base = eventName === "pull_request" ? event.pull_request?.base?.sha : eventName === "push" ? event.before : undefined
    if (typeof base !== "string" || !/^[a-f0-9]{40}$/i.test(base) || /^0+$/.test(base)) return undefined

    try {
        return execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", base, "HEAD", "--"], {
            encoding: "utf8",
            maxBuffer: 16 * 1024 ** 2,
            stdio: ["ignore", "pipe", "pipe"]
        }).split("\0").filter(Boolean)
    } catch {
        console.error("Comparison base unavailable. Running all CI lanes.")
        return undefined
    }
}

if (require.main === module) {
    const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : {}
    const paths = process.argv.length > 2 ? process.argv.slice(2) : changedPaths(process.env.GITHUB_EVENT_NAME, event)
    const plan = planForPaths(paths)
    console.log(JSON.stringify(plan))
    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(
            process.env.GITHUB_OUTPUT,
            `lanes=${JSON.stringify(plan.lanes)}\nhas_work=${plan.lanes.length > 0}\nservice_scopes=${plan.serviceScopes.join(" ")}\n`
        )
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(
            process.env.GITHUB_STEP_SUMMARY,
            `Affected applications: ${plan.applications.join(", ") || "none"}\n\nCI lanes: ${plan.lanes.join(", ") || "none"}\n\nServer lint scopes: ${plan.serviceScopes.join(", ") || "none"}\n`
        )
    }
}

module.exports = { changedPaths, planForPaths }
