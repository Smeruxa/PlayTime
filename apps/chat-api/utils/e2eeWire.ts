export const MAX_E2EE_BODY_CHARS = 12_000
export const DM_E2EE_PREFIX = "E2E1:"
export const ROOM_E2EE_PREFIX = "R2E1:"

const MAX_PLAINTEXT_UTF8 = 2000 * 4
const MIN_BOXED_BYTES = 16
const MAX_BOXED_BYTES = MIN_BOXED_BYTES + MAX_PLAINTEXT_UTF8
const NONCE_BYTES = 24

const MAX_B64_CHARS_B = Math.ceil((MAX_BOXED_BYTES * 4) / 3) + 4

const B64_RE = /^[A-Za-z0-9+/=_-]+$/

function isBase64Field(s: string, maxChars: number): boolean {
    return typeof s === "string" && s.length > 0 && s.length <= maxChars && B64_RE.test(s)
}

export type E2eeWire = { n: string; b: string; e?: number }

export function isPlainRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v)
}

export function parseE2eeWireJsonString(jsonPart: string): E2eeWire | null {
    let o: unknown
    try {
        o = JSON.parse(jsonPart)
    } catch {
        return null
    }
    if (!isPlainRecord(o)) return null
    const b = o["b"]
    const n = o["n"]
    if (typeof b !== "string" || typeof n !== "string") return null
    if (o.e === undefined) return { n, b }
    if (typeof o.e !== "number" || !Number.isSafeInteger(o.e) || o.e < 0 || o.e > 2147483647) return null
    return { n, b, e: o.e }
}

export function isValidE2eeWireFields(b: string, n: string): boolean {
    if (!isBase64Field(n, 48) || !isBase64Field(b, MAX_B64_CHARS_B)) return false
    let nBuf: Buffer
    let bBuf: Buffer
    try {
        nBuf = Buffer.from(n, "base64")
        bBuf = Buffer.from(b, "base64")
    } catch {
        return false
    }
    if (nBuf.length !== NONCE_BYTES) return false
    if (bBuf.length < MIN_BOXED_BYTES || bBuf.length > MAX_BOXED_BYTES) return false
    return true
}

export function isValidE2eeEnvelopeBody(prefix: string, content: string): boolean {
    if (!content.startsWith(prefix)) return false
    if (content.length > MAX_E2EE_BODY_CHARS) return false
    const wire = parseE2eeWireJsonString(content.slice(prefix.length))
    if (!wire) return false
    return isValidE2eeWireFields(wire.b, wire.n)
}
