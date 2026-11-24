export function packetByteLength(packet: unknown[]): number {
    let nodes = 0
    const measure = (value: unknown, depth: number): number => {
        if (++nodes > 10_000 || depth > 64) return Infinity
        if (value === null || value === undefined) return 4
        if (typeof value === "function") return 0
        if (typeof value === "string") return Buffer.byteLength(JSON.stringify(value))
        if (typeof value === "number") return Number.isFinite(value) ? String(value).length : Infinity
        if (typeof value === "boolean") return value ? 4 : 5
        if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
            return value.byteLength + 64
        }
        if (Array.isArray(value)) {
            let bytes = 2 + Math.max(0, value.length - 1)
            for (const item of value) {
                bytes += measure(item, depth + 1)
                if (!Number.isFinite(bytes)) return Infinity
            }
            return bytes
        }
        if (typeof value === "object") {
            let bytes = 2
            for (const [key, item] of Object.entries(value)) {
                bytes += Buffer.byteLength(JSON.stringify(key)) + 2 + measure(item, depth + 1)
                if (!Number.isFinite(bytes)) return Infinity
            }
            return bytes
        }
        return Infinity
    }
    return measure(packet, 0)
}
