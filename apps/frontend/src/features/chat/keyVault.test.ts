import { waitFor } from "@testing-library/react"
import type { BrowserKeyRecord } from "./browserKeyStore"

const mockDurableRecords = new Map<number, BrowserKeyRecord>()
jest.mock("./browserKeyStore", () => ({
    validateKeys: jest.requireActual("./browserKeyStore").validateKeys,
    browserKeyTransaction: jest.fn(async (userId: number, initialize: () => object, update?: (record: BrowserKeyRecord) => void) => {
        const stored = mockDurableRecords.get(userId)
        const record: BrowserKeyRecord = stored ? JSON.parse(JSON.stringify(stored)) : { ...initialize(), userId, revision: 0 }
        update?.(record)
        if (!stored || update) {
            record.revision++
            mockDurableRecords.set(userId, JSON.parse(JSON.stringify(record)))
        }
        return record
    })
}))

const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
const previousBridge = window.electronAPI
const previousLocks = navigator.locks
beforeEach(() => {
    jest.resetModules()
    localStorage.clear()
    mockDurableRecords.clear()
})
afterEach(() => {
    window.electronAPI = previousBridge
    Object.defineProperty(navigator, "locks", { configurable: true, value: previousLocks })
})

function webTabs() {
    window.electronAPI = undefined as unknown as Window["electronAPI"]
    const queues = new Map<string, Promise<unknown>>()
    const request = jest.fn((name: string, callback: () => unknown) => {
        const work = (queues.get(name) ?? Promise.resolve()).catch(() => {}).then(callback)
        queues.set(name, work)
        return work
    })
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request } })
    const tabs: { vault: typeof import("./keyVault"); dm: typeof import("./dmE2ee"); store: typeof import("./browserKeyStore") }[] = []
    for (let i = 0; i < 2; i++) jest.isolateModules(() => {
        tabs.push({ vault: require("./keyVault"), dm: require("./dmE2ee"), store: require("./browserKeyStore") })
    })
    return { tabs, request }
}

test("simultaneous first-time browser tabs publish the same durable DM identity", async () => {
    const { tabs: [first, second], request } = webTabs()
    await Promise.all([first.vault.hydrateKeys(42), second.vault.hydrateKeys(42)])
    expect(first.dm.getDmPublicKeyB64(42)).toBeNull()
    expect(second.dm.getDmPublicKeyB64(42)).toBeNull()
    const [firstPublic, secondPublic] = await Promise.all([first.dm.ensureDmKeyPair(42), second.dm.ensureDmKeyPair(42)])
    expect(firstPublic).toEqual(secondPublic)
    expect(firstPublic).toHaveLength(44)
    expect(first.dm.getDmPublicKeyB64(42)).toBe(firstPublic)
    expect(second.dm.getDmPublicKeyB64(42)).toBe(firstPublic)
    expect(mockDurableRecords.get(42)?.keys.dm).toHaveLength(44)
    expect(localStorage.getItem("playtime_keys_dev:42")).toBeNull()
    expect(request.mock.calls.every(([name]) => name === "playtime:key-vault:42")).toBe(true)
})

test("room-key writes from stale browser tabs merge with durable keys instead of dropping them", async () => {
    const { tabs: [first, second] } = webTabs()
    localStorage.setItem("playtime_keys_dev:42", JSON.stringify({ dm: key }))
    await Promise.all([first.vault.hydrateKeys(42), second.vault.hydrateKeys(42)])
    await Promise.all([
        first.vault.writeSecret("room:1", "first", 42),
        second.vault.writeSecret("room:2", "second", 42)
    ])
    await Promise.all([first.vault.hydrateKeys(42), second.vault.hydrateKeys(42)])
    expect(first.vault.snapshotKeys(42)).toEqual({ dm: key, "room:1": "first", "room:2": "second" })
    expect(second.vault.readSecret("room:1", 42)).toBe("first")
    await first.vault.writeSecret("room:1", null, 42)
    await second.vault.writeSecret("room:3", "third", 42)
    await first.vault.hydrateKeys(42)
    expect(first.vault.snapshotKeys(42)).toEqual({ dm: key, "room:2": "second", "room:3": "third" })
})

test("an intentional restore replaces keys and other tabs reload the committed record on notification", async () => {
    const { tabs: [first, second] } = webTabs()
    await first.vault.replaceKeys(42, { dm: key, "room:1": "old" })
    await second.vault.hydrateKeys(42)
    await first.vault.replaceKeys(42, { dm: "restored", "room:2": "new" })
    await second.vault.hydrateKeys(99)
    window.dispatchEvent(new StorageEvent("storage", { key: first.vault.browserKeyChangeStorageKey(42), newValue: "2" }))
    await waitFor(() => expect(second.vault.snapshotKeys(42)).toEqual({ dm: "restored", "room:2": "new" }))
    expect(second.vault.currentKeyUserId()).toBe(99)
})

test("browser legacy migration is durable and does not resurrect an earlier DM key", async () => {
    const { tabs: [first] } = webTabs()
    localStorage.setItem("playtime_dm_secret_key_b64:42", key)
    await first.vault.hydrateKeys(42)
    expect(mockDurableRecords.get(42)?.keys).toEqual({ dm: key })
    expect(localStorage.getItem("playtime_keys_dev:42")).toBeNull()
    expect(localStorage.getItem("playtime_dm_secret_key_b64:42")).toBeNull()
    await first.vault.replaceKeys(42, { dm: "restored" })
    localStorage.setItem("playtime_keys_dev:42", JSON.stringify({ dm: "stale-renderer-copy" }))
    await first.vault.hydrateKeys(42)
    expect(first.vault.readSecret("dm", 42)).toBe("restored")
})

test("unsupported locking and corrupted browser storage fail without overwriting key material", async () => {
    const { tabs: [first] } = webTabs()
    localStorage.setItem("playtime_keys_dev:42", "corrupted")
    await expect(first.dm.ensureDmKeyPair(42)).rejects.toThrow()
    expect(first.vault.readSecret("dm", 42)).toBeNull()
    expect(localStorage.getItem("playtime_keys_dev:42")).toBe("corrupted")
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined })
    await expect(first.vault.writeSecret("dm", key, 42)).rejects.toThrow("HTTPS")
    expect(localStorage.getItem("playtime_keys_dev:42")).toBe("corrupted")
})

test("legacy keys are removed only after the OS-protected write succeeds", async () => {
    localStorage.setItem("playtime_dm_secret_key_b64:42", key)
    const write = jest.fn().mockRejectedValueOnce(new Error("vault locked")).mockResolvedValue(undefined)
    window.electronAPI = {
        readEncryptionKeys: async () => ({}),
        writeEncryptionKeys: write
    } as unknown as Window["electronAPI"]
    const vault = require("./keyVault") as typeof import("./keyVault")
    await expect(vault.hydrateKeys(42)).rejects.toThrow("vault locked")
    expect(localStorage.getItem("playtime_dm_secret_key_b64:42")).toBe(key)
    await vault.hydrateKeys(42)
    expect(localStorage.getItem("playtime_dm_secret_key_b64:42")).toBe(null)
    expect(vault.readSecret("dm", 42)).toBe(key)
})
test("concurrent room-key saves preserve every key", async () => {
    const writes: Record<string, string>[] = []
    window.electronAPI = {
        readEncryptionKeys: async () => ({ dm: key }),
        writeEncryptionKeys: async (_id: number, keys: Record<string, string>) => {
            writes.push({ ...keys })
        }
    } as unknown as Window["electronAPI"]
    const vault = require("./keyVault") as typeof import("./keyVault")
    await vault.hydrateKeys(42)
    await Promise.all([
        vault.writeSecret("room:1", key),
        vault.writeSecret("room:2", key),
        vault.writeSecret("room:3", key)
    ])
    expect(writes[writes.length - 1]).toEqual({ dm: key, "room:1": key, "room:2": key, "room:3": key })
    expect(localStorage.length).toBe(0)
})
test("explicit empty restores and deleted room keys cannot resurrect stale legacy copies", async () => {
    const { tabs: [first, second] } = webTabs()
    await first.vault.replaceKeys(42, {})
    localStorage.setItem("playtime_keys_dev:42", JSON.stringify({ dm: key }))
    localStorage.setItem("playtime_dm_secret_key_b64:42", key)
    localStorage.setItem("playtime_room_sym_b64_1", key)
    await second.vault.hydrateKeys(42)
    await second.vault.migrateRoomKeys([1])
    expect(second.vault.snapshotKeys(42)).toEqual({})
    expect(second.vault.canReadLegacyRoomKey(1)).toBe(false)
    await second.vault.hydrateKeys(43)
    await second.vault.writeSecret("room:2", null, 43)
    localStorage.setItem("playtime_room_sym_b64_2", key)
    await second.vault.migrateRoomKeys([2])
    expect(second.vault.readSecret("room:2", 43)).toBeNull()
    expect(second.vault.canReadLegacyRoomKey(2)).toBe(false)
})

test("an IndexedDB commit failure leaves legacy material available for a retry", async () => {
    const { tabs: [first] } = webTabs()
    localStorage.setItem("playtime_dm_secret_key_b64:42", key)
    ;(first.store.browserKeyTransaction as jest.Mock).mockRejectedValueOnce(new Error("quota exceeded"))
    await expect(first.vault.hydrateKeys(42)).rejects.toThrow("quota exceeded")
    expect(first.vault.readSecret("dm", 42)).toBeNull()
    expect(localStorage.getItem("playtime_dm_secret_key_b64:42")).toBe(key)
    await first.vault.hydrateKeys(42)
    expect(first.vault.readSecret("dm", 42)).toBe(key)
})
export {}
