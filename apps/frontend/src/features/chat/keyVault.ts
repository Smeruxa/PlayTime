import { browserKeyTransaction, validateKeys, type BrowserKeyRecord } from "./browserKeyStore"

const caches = new Map<number, Record<string, string>>()
const browserRecords = new Map<number, BrowserKeyRecord>()
const pending = new Map<number, Promise<void>>()
const mutations = new Map<number, Promise<unknown>>()
let currentUserId: number | null = null
export const currentKeyUserId = () => currentUserId
export const browserKeyStorageKey = (id: number) => `playtime_keys_dev:${id}`
export const browserKeyChangeStorageKey = (id: number) => `playtime_keys_changed:${id}`
const nativeVault = () => !!window.electronAPI?.readEncryptionKeys

function legacyBrowserKeys(userId: number): Omit<BrowserKeyRecord, "userId" | "revision"> {
    const raw = localStorage.getItem(browserKeyStorageKey(userId))
    const keys = raw === null ? {} : validateKeys(JSON.parse(raw))
    if (raw === null) {
        const legacy = localStorage.getItem(`playtime_dm_secret_key_b64:${userId}`)
        if (legacy) keys.dm = legacy
    }
    return { keys, deleted: [], allowLegacyRooms: raw === null || Object.keys(keys).length > 0 }
}

function acceptBrowserRecord(record: BrowserKeyRecord): void {
    const previous = browserRecords.get(record.userId)
    if (previous && previous.revision >= record.revision) return
    browserRecords.set(record.userId, record)
    caches.set(record.userId, { ...record.keys })
    if (previous && previous.keys.dm !== record.keys.dm)
        window.dispatchEvent(new CustomEvent("playtime:keys-updated", { detail: { userId: record.userId } }))
}

function clearMigratedKeys(userId: number): void {
    try {
        localStorage.removeItem(browserKeyStorageKey(userId))
        localStorage.removeItem(`playtime_dm_secret_key_b64:${userId}`)
    } catch {  }
}

async function browserTransaction(userId: number, update?: (record: BrowserKeyRecord) => void): Promise<BrowserKeyRecord> {
    const record = await browserKeyTransaction(userId, () => legacyBrowserKeys(userId), update)
    acceptBrowserRecord(record)
    clearMigratedKeys(userId)
    if (update) {
        try { localStorage.setItem(browserKeyChangeStorageKey(userId), String(record.revision)) }
        catch {  }
    }
    return record
}

if (typeof window !== "undefined") {
    window.addEventListener("storage", event => {
        if (nativeVault() || (event.storageArea && event.storageArea !== localStorage)) return
        const ids = event.key === null ? Array.from(browserRecords.keys())
            : event.key.startsWith("playtime_keys_changed:") ? [Number(event.key.slice("playtime_keys_changed:".length))] : []
        for (const id of ids) if (browserRecords.has(id)) void browserTransaction(id).catch(() => {})
    })
    window.addEventListener("focus", () => {
        if (!nativeVault() && currentUserId != null) void browserTransaction(currentUserId).catch(() => {})
    })
}

function mutate<T>(userId: number, update: () => Promise<T>): Promise<T> {
    const work = (mutations.get(userId) ?? Promise.resolve()).catch(() => {}).then(async (): Promise<T> => {
        if (nativeVault()) return update()
        if (!navigator.locks?.request)
            throw new Error("Безопасное хранилище ключей недоступно. Откройте PlayTime по HTTPS в современном браузере.")
        return await navigator.locks.request(`playtime:key-vault:${userId}`, update)
    })
    mutations.set(userId, work)
    return work.finally(() => {
        if (mutations.get(userId) === work) mutations.delete(userId)
    })
}

export async function hydrateKeys(userId: number): Promise<void> {
    currentUserId = userId
    if (nativeVault() && caches.has(userId)) return
    if (pending.has(userId)) return pending.get(userId)
    const work = mutate(userId, async () => {
        if (!nativeVault()) { await browserTransaction(userId); return }
        const keys = await window.electronAPI!.readEncryptionKeys!(userId)
        const legacy = localStorage.getItem(`playtime_dm_secret_key_b64:${userId}`)
        if (!keys.dm && legacy) keys.dm = legacy
        if (legacy) {
            await persistNativeKeys(userId, keys)
            localStorage.removeItem(`playtime_dm_secret_key_b64:${userId}`)
        }
        caches.set(userId, keys)
    })
    pending.set(userId, work)
    try { await work } finally { pending.delete(userId) }
}

export function readSecret(name: string, userId = currentUserId): string | null {
    return userId == null ? null : caches.get(userId)?.[name] ?? null
}

export function snapshotKeys(userId: number): Record<string, string> {
    return { ...caches.get(userId) }
}

async function persistNativeKeys(userId: number, keys: Record<string, string>): Promise<void> {
    await window.electronAPI!.writeEncryptionKeys!(userId, keys)
    caches.set(userId, { ...keys })
}

export function replaceKeys(userId: number, keys: Record<string, string>): Promise<void> {
    const replacement = validateKeys(keys)
    return mutate(userId, async () => {
        if (nativeVault()) return persistNativeKeys(userId, replacement)
        await browserTransaction(userId, record => {
            record.keys = replacement
            record.deleted = []
            record.allowLegacyRooms = false
        })
    })
}

export async function getOrCreateSecret(name: string, userId: number, create: () => string, valid: (value: string) => boolean): Promise<string> {
    await hydrateKeys(userId)
    return mutate(userId, async () => {
        if (nativeVault()) {
            const keys = snapshotKeys(userId)
            if (keys[name] && valid(keys[name])) return keys[name]
            const value = create()
            await persistNativeKeys(userId, { ...keys, [name]: value })
            return value
        }
        const record = await browserTransaction(userId, record => {
            if (!record.keys[name] || !valid(record.keys[name])) record.keys[name] = create()
        })
        return record.keys[name]
    })
}

export async function flushKeys(userId: number): Promise<void> {
    await mutations.get(userId)
    if (!nativeVault()) await hydrateKeys(userId)
}

export async function writeSecret(name: string, value: string | null, userId = currentUserId): Promise<void> {
    if (userId == null) throw new Error("Сначала войдите в аккаунт")
    await hydrateKeys(userId)
    await mutate(userId, async () => {
        if (nativeVault()) {
            const keys = snapshotKeys(userId)
            if (value == null) delete keys[name]
            else keys[name] = value
            return persistNativeKeys(userId, keys)
        }
        await browserTransaction(userId, record => {
            if (value == null) {
                delete record.keys[name]
                if (!record.deleted.includes(name)) record.deleted.push(name)
            } else record.keys[name] = value
        })
    })
}

export function canReadLegacyRoomKey(roomId: number): boolean {
    if (nativeVault()) return true
    const record = currentUserId == null ? undefined : browserRecords.get(currentUserId)
    return !!record?.allowLegacyRooms && !record.deleted.includes(`room:${roomId}`)
}

export async function migrateRoomKeys(roomIds: number[]): Promise<void> {
    const userId = currentUserId
    if (userId == null) return
    for (const roomId of roomIds) {
        const legacyName = `playtime_room_sym_b64_${roomId}`, name = `room:${roomId}`
        const value = localStorage.getItem(legacyName)
        if (!value) continue
        if (readSecret(name, userId) !== value) continue
        localStorage.removeItem(legacyName)
    }
}
