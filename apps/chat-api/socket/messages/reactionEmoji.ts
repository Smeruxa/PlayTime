import emojiRegex from "emoji-regex"

export function parseSingleReactionEmoji(raw: unknown): string | null {
    if (raw == null) return null
    const t = typeof raw === "string" ? raw.trim() : String(raw).trim()
    if (!t || t.length > 32) return null
    const re = emojiRegex()
    const m = re.exec(t)
    if (!m || m.index !== 0) return null
    const g = m[0]
    if (g.length !== t.length) return null
    return g
}
