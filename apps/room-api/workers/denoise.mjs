import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"

const require = createRequire(import.meta.url)
const pkgRoot = dirname(require.resolve("@jitsi/rnnoise-wasm/package.json"))
const wasmBinary = readFileSync(join(pkgRoot, "dist", "rnnoise.wasm"))
const { default: createRNNWasmModule } = await import(pathToFileURL(join(pkgRoot, "dist", "rnnoise.js")).href)
const wasm = await createRNNWasmModule({ wasmBinary })

const FRAME = 480
const PCM_INPUT_BYTES = FRAME * 4
const MAX_STREAMS = Number.parseInt(process.env.SERVER_DENOISE_MAX_STREAMS_PER_WORKER ?? "256", 10) || 256

const streams = new Map()

function destroyStreamState(st) {
    if (st.ctx) wasm._rnnoise_destroy(st.ctx)
    if (st.wasmPcmPtr) wasm._free(st.wasmPcmPtr)
}

function evictOldestStream() {
    let oldestKey = null
    let oldest = Infinity
    for (const [k, v] of streams) {
        if (v.last < oldest) {
            oldest = v.last
            oldestKey = k
        }
    }
    if (oldestKey == null) return
    destroyStreamState(streams.get(oldestKey))
    streams.delete(oldestKey)
}

function getStreamState(streamKey) {
    let st = streams.get(streamKey)
    const now = Date.now()
    if (st) {
        st.last = now
        return st
    }
    while (streams.size >= MAX_STREAMS) {
        evictOldestStream()
    }
    const wasmPcmPtr = wasm._malloc(PCM_INPUT_BYTES)
    if (!wasmPcmPtr) throw new Error("rnnoise: wasm malloc failed")
    const ctx = wasm._rnnoise_create()
    if (!ctx) {
        wasm._free(wasmPcmPtr)
        throw new Error("rnnoise: _rnnoise_create failed")
    }
    st = { last: now, ctx, wasmPcmPtr, wasmPcmF32Index: wasmPcmPtr >> 2, carry: new Int16Array(0) }
    streams.set(streamKey, st)
    return st
}

function writeInt16FrameToHeap(heapIdx, input480) {
    for (let i = 0; i < FRAME; i++) {
        const s = input480[i]
        const f = s < 0 ? s / 32768 : s / 32767
        wasm.HEAPF32[heapIdx + i] = f * 32768
    }
}

function readInt16FrameFromHeap(heapIdx, out480) {
    for (let i = 0; i < FRAME; i++) {
        let f = wasm.HEAPF32[heapIdx + i] / 32768
        if (f > 1) f = 1
        else if (f < -1) f = -1
        const n = f < 0 ? Math.round(f * 32768) : Math.round(f * 32767)
        out480[i] = n < -32768 ? -32768 : n > 32767 ? 32767 : n
    }
}

function processFrameInt16(st, input480) {
    const { wasmPcmF32Index, wasmPcmPtr, ctx } = st
    writeInt16FrameToHeap(wasmPcmF32Index, input480)
    wasm._rnnoise_process_frame(ctx, wasmPcmPtr, wasmPcmPtr)
    const out = new Int16Array(FRAME)
    readInt16FrameFromHeap(wasmPcmF32Index, out)
    return out
}

function denoisePcmChunk(st, input) {
    const L = input.length
    const c = st.carry.length
    const work = new Int16Array(c + L)
    if (c > 0) work.set(st.carry, 0)
    work.set(input, c)

    const nFull = Math.floor(work.length / FRAME) * FRAME
    const denoised = new Int16Array(nFull)
    for (let off = 0; off < nFull; off += FRAME) {
        denoised.set(processFrameInt16(st, work.subarray(off, off + FRAME)), off)
    }

    const out = new Int16Array(L)
    for (let i = 0; i < L; i++) {
        const pos = c + i
        out[i] = pos < nFull ? denoised[pos] : work[pos]
    }

    st.carry = nFull < work.length ? new Int16Array(work.subarray(nFull)) : new Int16Array(0)
    return out
}

process.on("message", (msg) => {
    if (!msg || msg.type !== "denoise") return
    const { id, payload } = msg
    const streamKey = typeof msg.streamKey === "string" && msg.streamKey.length > 0 ? msg.streamKey : "_"
    try {
        const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
        if (buf.length % 2 !== 0) {
            process.send({ type: "error", id, error: "Odd byte length" })
            return
        }
        const st = getStreamState(streamKey)
        const input = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2)
        const out = input.length === 0 ? new Int16Array(0) : denoisePcmChunk(st, input)
        const outBuf = Buffer.from(out.buffer, out.byteOffset, out.byteLength)
        process.send({ type: "result", id, payload: outBuf })
    } catch (e) {
        process.send({ type: "error", id, error: e instanceof Error ? e.message : String(e) })
    }
})
