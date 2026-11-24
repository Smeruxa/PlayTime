export type BrowserKeyRecord = {
    userId: number
    revision: number
    keys: Record<string, string>
    deleted: string[]
    allowLegacyRooms: boolean
}

const DATABASE = "playtime-encryption-keys"
const STORE = "accounts"
let connection: Promise<IDBDatabase> | null = null
const unavailable = () => new Error("Не удалось открыть хранилище ключей переписки. Проверьте разрешение браузера на хранение данных.")

export function validateKeys(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some(item => typeof item !== "string"))
        throw new Error("Не удалось прочитать ключи переписки. Восстановите их резервную копию.")
    return { ...value as Record<string, string> }
}

function database(): Promise<IDBDatabase> {
    if (connection) return connection
    connection = new Promise<IDBDatabase>((resolve, reject) => {
        if (typeof indexedDB === "undefined") { reject(unavailable()); return }
        const request = indexedDB.open(DATABASE, 1)
        request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "userId" })
        request.onerror = () => reject(request.error || unavailable())
        request.onblocked = () => reject(unavailable())
        request.onsuccess = () => {
            request.result.onversionchange = () => {
                request.result.close()
                connection = null
            }
            resolve(request.result)
        }
    }).catch(error => { connection = null; throw error })
    return connection
}

export async function browserKeyTransaction(
    userId: number,
    initialize: () => Omit<BrowserKeyRecord, "userId" | "revision">,
    update?: (record: BrowserKeyRecord) => void
): Promise<BrowserKeyRecord> {
    const db = await database()
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, "readwrite")
        const store = transaction.objectStore(STORE)
        const request = store.get(userId)
        let record: BrowserKeyRecord
        let failure: unknown
        request.onsuccess = () => {
            try {
                const stored = request.result as BrowserKeyRecord | undefined
                record = stored ? { ...stored, keys: validateKeys(stored.keys), deleted: [...stored.deleted] }
                    : { ...initialize(), userId, revision: 0 }
                update?.(record)
                record.keys = validateKeys(record.keys)
                if (!stored || update) {
                    record.revision++
                    store.put(record)
                }
            } catch (error) { failure = error; transaction.abort() }
        }
        transaction.oncomplete = () => resolve(record)
        transaction.onerror = () => reject(failure || transaction.error || unavailable())
        transaction.onabort = () => reject(failure || transaction.error || unavailable())
    })
}
