import type { DisplayMessage } from "./types"

export type ReactionMap = { emoji: string; users: string[] }[]

type RawRx = { emoji?: string; by?: string }

function parseReactionsJson(raw: unknown): ReactionMap {
    if (raw == null) return []
    let arr: unknown[] = []
    if (Array.isArray(raw)) arr = raw
    else if (typeof raw === "string") {
        try {
            const p = JSON.parse(raw) as unknown
            if (Array.isArray(p)) arr = p
        } catch {
            return []
        }
    } else return []
    const map = new Map<string, Set<string>>()
    for (const x of arr) {
        if (!x || typeof x !== "object") continue
        const o = x as RawRx
        if (typeof o.emoji !== "string" || typeof o.by !== "string") continue
        let s = map.get(o.emoji)
        if (!s) {
            s = new Set()
            map.set(o.emoji, s)
        }
        s.add(o.by)
    }
    return Array.from(map.entries(), ([emoji, set]) => ({ emoji, users: Array.from(set).sort() }))
}

export function reactionsFromHistoryField(raw: unknown): ReactionMap {
    return parseReactionsJson(raw)
}

export function applyReactionEvent(
    prev: ReactionMap,
    username: string,
    emoji: string,
    active: boolean
): ReactionMap {
    const map = new Map<string, string[]>()
    for (const g of prev) map.set(g.emoji, [...g.users])
    let u = map.get(emoji) ?? []
    if (active) {
        if (!u.includes(username)) u = [...u, username].sort()
    } else {
        u = u.filter((n) => n !== username)
    }
    if (u.length === 0) map.delete(emoji)
    else map.set(emoji, u)
    return Array.from(map.entries(), ([e, us]) => ({ emoji: e, users: us })).sort((a, b) =>
        a.emoji.localeCompare(b.emoji)
    )
}

export function withMessageReactions(m: DisplayMessage, next: ReactionMap): DisplayMessage {
    return next.length === 0
        ? { ...m, reactions: undefined }
        : { ...m, reactions: next }
}
