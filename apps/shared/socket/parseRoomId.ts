export function parseRoomIdField(value: unknown): number | null {
    const n = parseInt(String(value), 10)
    if (!Number.isFinite(n) || n <= 0) return null
    return n
}
