export type ChatDate = { key: string; label: string }

export function getChatDate(timestamp: number): ChatDate | null {
    if (!Number.isFinite(timestamp)) return null
    const date = new Date(timestamp)
    if (!Number.isFinite(date.getTime())) return null

    const day = String(date.getDate()).padStart(2, "0")
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const year = date.getFullYear()
    const fullYear = `${year < 0 ? "-" : ""}${String(Math.abs(year)).padStart(4, "0")}`
    const shortYear = String(Math.abs(year) % 100).padStart(2, "0")
    return { key: `${fullYear}-${month}-${day}`, label: `${day}.${month}.${shortYear}` }
}
