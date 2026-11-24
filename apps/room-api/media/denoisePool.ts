import { fork, type ChildProcess } from "child_process"
import path from "path"

type WorkerIncoming = { type: "denoise"; id: number; streamKey: string; payload: Buffer }

function slotIndexForStreamKey(streamKey: string, slotCount: number): number {
    let h = 2166136261
    for (let i = 0; i < streamKey.length; i++) {
        h ^= streamKey.charCodeAt(i)
        h = Math.imul(h, 16777619)
    }
    return (h >>> 0) % slotCount
}
type WorkerOutgoing = { type: "result"; id: number; payload: Buffer } | { type: "error"; id: number; error: string }

function isServerDenoiseEnabled(): boolean {
    const v = process.env.SERVER_DENOISE_ENABLED
    if (!v) return false
    return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes"
}

function workerCount(): number {
    const n = parseInt(process.env.SERVER_DENOISE_WORKERS ?? "2", 10)
    if (!Number.isFinite(n) || n < 1) return 1
    return Math.min(n, 8)
}

function workerScriptPath(): string {
    return path.join(__dirname, "..", "workers", "denoise.mjs")
}

class Mutex {
    private tail: Promise<unknown> = Promise.resolve()

    runExclusive<T>(fn: () => Promise<T>): Promise<T> {
        const next = this.tail.then(() => fn()) as Promise<T>
        this.tail = next.then(
            () => undefined,
            () => undefined
        )
        return next
    }
}

class ForkSlot {
    private cp: ChildProcess | null = null
    private readonly mutex = new Mutex()
    private readonly scriptPath: string

    constructor(scriptPath: string) {
        this.scriptPath = scriptPath
    }

    private ensureChild(): ChildProcess {
        if (this.cp && !this.cp.killed) return this.cp
        const child = fork(this.scriptPath, [], {
            stdio: ["ignore", "pipe", "pipe", "ipc"],
            execArgv: []
        })
        child.stderr?.on("data", (d) => {
            const s = d.toString().trim()
            if (s) console.error("[denoise worker]", s)
        })
        child.on("exit", (code, signal) => {
            if (code !== 0 && code != null) console.warn("[denoise worker] exit", code, signal)
            if (this.cp === child) this.cp = null
        })
        this.cp = child
        return child
    }

    process(payload: Buffer, id: number, streamKey: string, timeoutMs: number): Promise<Buffer> {
        return this.mutex.runExclusive(() => this.runOnce(payload, id, streamKey, timeoutMs))
    }

    private runOnce(payload: Buffer, id: number, streamKey: string, timeoutMs: number): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            let child: ChildProcess
            try {
                child = this.ensureChild()
            } catch (e) {
                reject(e instanceof Error ? e : new Error(String(e)))
                return
            }
            const timer = setTimeout(() => {
                cleanup()
                reject(new Error("denoise_timeout"))
            }, timeoutMs)
            const onMsg = (raw: unknown) => {
                const msg = raw as WorkerOutgoing
                if (!msg || typeof msg !== "object" || msg.id !== id) return
                cleanup()
                if (msg.type === "result") {
                    resolve(Buffer.isBuffer(msg.payload) ? msg.payload : Buffer.from(msg.payload))
                    return
                }
                reject(new Error(msg.type === "error" ? msg.error : "denoise_error"))
            }
            const onExit = () => {
                cleanup()
                reject(new Error("denoise_worker_exit"))
            }
            const cleanup = () => {
                clearTimeout(timer)
                child.off("message", onMsg)
                child.off("exit", onExit)
            }
            child.on("message", onMsg)
            child.once("exit", onExit)
            const outgoing: WorkerIncoming = { type: "denoise", id, streamKey, payload }
            child.send(outgoing)
        })
    }
}

export class DenoisePool {
    private readonly slots: ForkSlot[]
    private seq = 1

    constructor() {
        const script = workerScriptPath()
        const n = workerCount()
        this.slots = Array.from({ length: n }, () => new ForkSlot(script))
    }

    async process(payload: Buffer, streamKey: string): Promise<Buffer> {
        const id = this.seq++
        const n = this.slots.length
        const idx = slotIndexForStreamKey(streamKey, n)
        const bounded = ((idx % n) + n) % n
        const slot = this.slots.find((_, i) => i === bounded)
        if (!slot) throw new Error("denoise: no worker slot")
        const timeoutMs = parseInt(process.env.SERVER_DENOISE_TIMEOUT_MS ?? "45", 10)
        const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 45
        return slot.process(payload, id, streamKey, ms)
    }
}

let pool: DenoisePool | null | undefined

export function getDenoisePool(): DenoisePool | null {
    if (!isServerDenoiseEnabled()) return null
    if (pool === undefined) {
        try {
            pool = new DenoisePool()
        } catch (e) {
            console.error("SERVER_DENOISE: failed to start pool", e)
            pool = null
        }
    }
    return pool
}
