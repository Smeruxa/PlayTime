const assert = require("node:assert/strict")
const { spawn } = require("node:child_process")
const { once } = require("node:events")
const { createServer, request } = require("node:http")
const { connect } = require("node:net")
const path = require("node:path")
const { createInterface } = require("node:readline")
const { setTimeout: delay } = require("node:timers/promises")

async function slotReady(gateway) {
    try {
        const response = await fetch(`${gateway.url}/http-readyz`, { signal: AbortSignal.timeout(750) })
        await response.body?.cancel()
        return response.ok && response.headers.get("x-playtime-gateway-slot") === gateway.slot
    } catch {
        return false
    }
}

async function startAutomaticSelection(t, edge, gateways) {
    const selector = spawn(
        "python3",
        [
            "-u",
            "-B",
            "-c",
            [
                "import json, sys, time",
                "from gateway_failover import GatewayFailover",
                "state = GatewayFailover()",
                "for line in sys.stdin:",
                "    active, probes = json.loads(line)",
                "    print(json.dumps(state.record(active, probes, time.monotonic())), flush=True)"
            ].join("\n")
        ],
        {
            cwd: path.resolve(__dirname, "../../deploy_backend"),
            stdio: ["pipe", "pipe", "inherit"]
        }
    )
    const lines = createInterface({ input: selector.stdout })
    const exited = once(selector, "exit")
    await once(selector, "spawn")
    let running = true
    const monitor = (async () => {
        while (running) {
            const states = await Promise.all(gateways.map(async (gateway) => [gateway.slot, await slotReady(gateway)]))
            const selected = once(lines, "line", { signal: AbortSignal.timeout(3000) })
            selector.stdin.write(JSON.stringify([edge.active, Object.fromEntries(states)]) + "\n")
            const next = JSON.parse((await selected)[0])
            if (next) edge.activate(next)
            await delay(1000)
        }
    })()
    monitor.catch(() => {})
    t.after(async () => {
        running = false
        try {
            await monitor
        } finally {
            selector.stdin.end()
            await exited
            lines.close()
        }
    })
}

async function startRolloutEdge(t, gateways) {
    const endpoints = new Map(gateways.map(({ slot, url }) => [slot, new URL(url)]))
    const upgraded = new Set()
    const socketRequests = []
    let active = "primary"

    function destination(incoming) {
        const url = new URL(incoming.url, "http://localhost")
        let slot = active
        if (url.pathname === "/playtime/socket.io/") {
            const sid = url.searchParams.get("sid")
            if (sid) slot = sid.startsWith("s_") ? "secondary" : "primary"
            socketRequests.push({ sid, slot, method: incoming.method, transport: url.searchParams.get("transport") })
        }
        return { slot, endpoint: endpoints.get(slot) }
    }

    const server = createServer((incoming, response) => {
        const { slot, endpoint } = destination(incoming)
        const upstream = request(
            new URL(incoming.url, endpoint),
            {
                method: incoming.method,
                headers: incoming.headers
            },
            (result) => {
                response.writeHead(result.statusCode, { ...result.headers, "x-test-gateway-slot": slot })
                result.on("error", () => response.destroy())
                result.pipe(response)
            }
        )
        upstream.on("error", () => {
            if (!response.headersSent) response.writeHead(502)
            response.end()
        })
        response.on("close", () => upstream.destroy())
        incoming.pipe(upstream)
    })
    server.on("upgrade", (incoming, downstream, head) => {
        const { endpoint } = destination(incoming)
        const upstream = connect(Number(endpoint.port), endpoint.hostname)
        upgraded.add(downstream)
        upstream.once("connect", () => {
            const lines = incoming.rawHeaders.flatMap((name, i, headers) =>
                i % 2 === 0 ? [name + ": " + headers[i + 1]] : []
            )
            upstream.write(
                [`${incoming.method} ${incoming.url} HTTP/${incoming.httpVersion}`, ...lines, "", ""].join("\r\n")
            )
            if (head.length) upstream.write(head)
            downstream.pipe(upstream).pipe(downstream)
        })
        downstream.on("error", () => upstream.destroy())
        upstream.on("error", () => downstream.destroy())
        downstream.on("close", () => {
            upgraded.delete(downstream)
            upstream.destroy()
        })
        upstream.on("close", () => downstream.destroy())
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    t.after(async () => {
        for (const socket of upgraded) socket.destroy()
        const closed = new Promise((resolve) => server.close(resolve))
        server.closeAllConnections()
        await closed
    })
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        socketRequests,
        get active() {
            return active
        },
        activate(slot) {
            assert.ok(endpoints.has(slot))
            active = slot
        }
    }
}

module.exports = { startRolloutEdge, startAutomaticSelection, slotReady }
