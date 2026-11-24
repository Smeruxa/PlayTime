import { randomRequestKey } from "./requestDeadline"
const DATABASE = "playtime-refresh-handoff"
const STORE = "consumed"
const RETENTION_MS = 366 * 24 * 60 * 60_000
let connection: Promise<IDBDatabase> | null = null

function database(): Promise<IDBDatabase> {
    if (connection) return connection
    connection = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DATABASE, 2)
        request.onupgradeneeded = () => {
            for (const name of [STORE, "requests"])
                if (!request.result.objectStoreNames.contains(name)) {
                    const store = request.result.createObjectStore(name, { keyPath: "digest" })
                    store.createIndex("expiresAt", "expiresAt")
                }
        }
        request.onerror = () => reject(request.error || new Error("Session coordination unavailable"))
        request.onblocked = () => reject(new Error("Session coordination unavailable"))
        request.onsuccess = () => {
            request.result.onversionchange = () => {
                request.result.close()
                connection = null
            }
            resolve(request.result)
        }
    }).catch((error) => {
        connection = null
        throw error
    })
    return connection
}

async function durableRequestKey(token: string, previous?: string, guest = false): Promise<string> {
    const key = await digest(token),
        db = await database()
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("requests", "readwrite")
        const store = transaction.objectStore("requests")
        const request = store.get(key)
        let requestKey: string
        request.onsuccess = () => {
            requestKey =
                guest && request.result?.retired
                    ? randomRequestKey()
                    : request.result?.requestKey || previous || randomRequestKey()
            store.put({ digest: key, requestKey, expiresAt: Date.now() + RETENTION_MS })
            const expired = store.index("expiresAt").openCursor(IDBKeyRange.upperBound(Date.now()))
            expired.onsuccess = () => {
                const cursor = expired.result
                if (cursor) {
                    cursor.delete()
                    cursor.continue()
                }
            }
        }
        transaction.oncomplete = () => resolve(requestKey)
        transaction.onerror = () => reject(transaction.error || new Error("Session coordination unavailable"))
        transaction.onabort = () => reject(transaction.error || new Error("Session coordination unavailable"))
    })
}

export const refreshRequestKey = (token: string) => durableRequestKey(`refresh:${token}`)
export const guestRequestKey = (username: string, previous?: string) =>
    durableRequestKey(`guest:${username}`, previous, true)

export async function retireGuestRequest(username: string, requestKey: string): Promise<void> {
    const key = await digest(`guest:${username}`),
        db = await database()
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("requests", "readwrite")
        const store = transaction.objectStore("requests"),
            request = store.get(key)
        request.onsuccess = () => {
            if (!request.result || request.result.requestKey === requestKey)
                store.put({ digest: key, requestKey, retired: true, expiresAt: Date.now() + RETENTION_MS })
        }
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error || new Error("Session coordination unavailable"))
        transaction.onabort = () => reject(transaction.error || new Error("Session coordination unavailable"))
    })
}

export async function publishGuestRequest(
    username: string,
    requestKey: string,
    publish: () => void,
    retired: () => void
): Promise<void> {
    const key = await digest(`guest:${username}`),
        db = await database()
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("requests", "readwrite"),
            store = transaction.objectStore("requests"),
            request = store.get(key)
        let published = false
        request.onsuccess = () => {
            if (request.result?.requestKey !== requestKey || request.result.retired) {
                reject(new Error("Этот вход уже завершён или отменён. Обновите страницу, чтобы продолжить."))
                return
            }
            try {
                publish()
                published = true
                store.put({ digest: key, requestKey, retired: true, expiresAt: Date.now() + RETENTION_MS })
                resolve()
            } catch (error) {
                transaction.abort()
                if (published) resolve()
                else reject(error)
            }
        }
        transaction.oncomplete = () => {
            if (published) {
                try {
                    retired()
                } catch {
                }
            }
        }
        transaction.onerror = transaction.onabort = () => {
            if (!published) reject(transaction.error || new Error("Session coordination unavailable"))
        }
    })
}

async function digest(token: string): Promise<string> {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export async function wasRefreshConsumed(token: string): Promise<boolean> {
    const key = await digest(token),
        db = await database()
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, "readonly")
        const request = transaction.objectStore(STORE).get(key)
        request.onsuccess = () => resolve(Boolean(request.result && request.result.expiresAt > Date.now()))
        request.onerror = () => reject(request.error || new Error("Session coordination unavailable"))
        transaction.onabort = () => reject(transaction.error || new Error("Session coordination unavailable"))
    })
}

export async function rememberConsumedRefresh(token: string): Promise<void> {
    const key = await digest(token),
        db = await database()
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, "readwrite")
        const store = transaction.objectStore(STORE)
        const expired = store.index("expiresAt").openCursor(IDBKeyRange.upperBound(Date.now()))
        expired.onsuccess = () => {
            const cursor = expired.result
            if (cursor) {
                cursor.delete()
                cursor.continue()
            }
        }
        store.put({ digest: key, expiresAt: Date.now() + RETENTION_MS })
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error || new Error("Session coordination unavailable"))
        transaction.onabort = () => reject(transaction.error || new Error("Session coordination unavailable"))
    })
}
