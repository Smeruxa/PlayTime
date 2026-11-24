const STORAGE_KEY = "pt_notify_muted_users"

function readSet(): Set<string> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return new Set()
        const arr = JSON.parse(raw) as unknown
        if (!Array.isArray(arr)) return new Set()
        return new Set(arr.filter((x) => typeof x === "string" && x.length > 0))
    } catch {
        return new Set()
    }
}

function writeSet(set: Set<string>): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)))
}

export function isUserNotifyMuted(username: string): boolean {
    if (!username) return false
    return readSet().has(username)
}

export function setUserNotifyMuted(username: string, muted: boolean): void {
    if (!username) return
    const set = readSet()
    if (muted) set.add(username)
    else set.delete(username)
    writeSet(set)
}

export function toggleUserNotifyMuted(username: string): boolean {
    const next = !isUserNotifyMuted(username)
    setUserNotifyMuted(username, next)
    return next
}

const peerPreferencesKey = (ownerId: number) => `pt_notify_muted_peers_v2:${ownerId}`

export function isPeerNotifyMuted(ownerId: number | null, peerId: number): boolean {
    if (ownerId === null) return false
    try {
        const muted: unknown = JSON.parse(localStorage.getItem(peerPreferencesKey(ownerId)) ?? "[]")
        return Array.isArray(muted) && muted.includes(peerId)
    } catch {
        return false
    }
}

export function togglePeerNotifyMuted(ownerId: number, peerId: number): boolean {
    let values: number[] = []
    try {
        const saved: unknown = JSON.parse(localStorage.getItem(peerPreferencesKey(ownerId)) ?? "[]")
        if (Array.isArray(saved)) values = saved.filter((id): id is number => Number.isSafeInteger(id) && id > 0)
    } catch {
    }
    const muted = !values.includes(peerId)
    const next = muted ? [...values, peerId] : values.filter((id) => id !== peerId)
    localStorage.setItem(peerPreferencesKey(ownerId), JSON.stringify(next))
    return muted
}
