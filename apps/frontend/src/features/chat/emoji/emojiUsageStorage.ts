import emojiRegex from "emoji-regex"
import { getChatEmojiList } from "./emojiDataset"

const STORAGE_KEY = "playtime.chatEmojiUsage.v1"
const PRUNE_AFTER_KEYS = 220
const PRUNE_KEEP_KEYS = 140

type Entry = { c: number; t: number }

let cache: Record<string, Entry> | null = null
const listeners = new Set<() => void>()
let version = 0

function bump() {
    version++
    listeners.forEach((fn) => fn())
}

export function subscribeEmojiUsage(onChange: () => void): () => void {
    listeners.add(onChange)
    return () => listeners.delete(onChange)
}

export function getEmojiUsageVersion(): number {
    return version
}

function readStore(): Record<string, Entry> {
    if (cache) return cache
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        cache = raw ? (JSON.parse(raw) as Record<string, Entry>) : {}
    } catch {
        cache = {}
    }
    return cache
}

function writeStore(data: Record<string, Entry>) {
    cache = data
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
    }
    bump()
}

function prune(data: Record<string, Entry>) {
    const keys = Object.keys(data)
    if (keys.length <= PRUNE_AFTER_KEYS) return data
    const ranked = keys.sort((a, b) => {
        const da = data[a]
        const db = data[b]
        return db.c - da.c || db.t - da.t
    })
    const next: Record<string, Entry> = {}
    for (let i = 0; i < PRUNE_KEEP_KEYS && i < ranked.length; i++) {
        const k = ranked[i]
        next[k] = data[k]
    }
    return next
}

export function recordEmojisInText(text: string) {
    const data = { ...readStore() }
    const now = Date.now()
    const re = emojiRegex()
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
        const em = match[0]
        const prev = data[em] ?? { c: 0, t: 0 }
        data[em] = { c: prev.c + 1, t: now }
        if (em.length === 0) re.lastIndex += 1
    }
    writeStore(prune(data))
}

let allowedEmojiSetMemo: ReadonlySet<string> | null = null

function allowedEmojiSet(): ReadonlySet<string> {
    if (!allowedEmojiSetMemo) allowedEmojiSetMemo = new Set(getChatEmojiList())
    return allowedEmojiSetMemo
}

export function getFrequentChatEmojis(limit: number): string[] {
    const allowed = allowedEmojiSet()
    const data = readStore()
    return Object.entries(data)
        .filter(([e]) => allowed.has(e))
        .sort((a, b) => {
            const ca = a[1].c
            const cb = b[1].c
            if (cb !== ca) return cb - ca
            return b[1].t - a[1].t
        })
        .slice(0, limit)
        .map(([e]) => e)
}
