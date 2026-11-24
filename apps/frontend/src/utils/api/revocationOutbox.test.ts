import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex } from "@noble/hashes/utils"
import { revokeSession } from "./revokeSession"
import { flushRevocationOutbox, queueSessionRevocation, REVOCATION_OUTBOX_KEY } from "./revocationOutbox"

jest.mock("../../config", () => ({ API_BASE: "https://api.test" }))
const originalFetch = global.fetch
const raw = "a".repeat(64)
const proof = bytesToHex(sha256(raw))
const key = `${REVOCATION_OUTBOX_KEY}:${proof}`
beforeEach(() => localStorage.clear())
afterEach(() => {
    global.fetch = originalFetch
    jest.useRealTimers()
})

test("logout persists only a revoke-only hash synchronously and keeps it after a lost response", async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError("offline"))
    localStorage.setItem("token", "new-login-token")
    const request = revokeSession("raw-access-token", raw)
    const stored = localStorage.getItem(key)
    expect(stored).toContain(proof)
    expect(stored).not.toContain(raw)
    expect(stored).not.toContain("raw-access-token")
    await request
    expect(localStorage.getItem(key)).not.toBeNull()
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).toEqual({ refreshTokenHash: proof })
    expect(localStorage.getItem("token")).toBe("new-login-token")
})

test("503 and request timeouts retain proof, and a later successful ACK removes it", async () => {
    jest.useFakeTimers()
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 })
    await revokeSession(null, raw)
    expect(localStorage.getItem(key)).not.toBeNull()
    ;(global.fetch as jest.Mock).mockImplementationOnce(() => new Promise(() => {}))
    jest.setSystemTime(Date.now() + 120_000)
    const retry = flushRevocationOutbox()
    await jest.advanceTimersByTimeAsync(12_001)
    await retry
    expect(localStorage.getItem(key)).not.toBeNull()
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true })
    jest.setSystemTime(Date.now() + 240_000)
    await flushRevocationOutbox()
    expect(localStorage.getItem(key)).toBeNull()
})

test("the outbox bounds retention, separates device proofs and avoids hot retry loops", async () => {
    jest.useFakeTimers()
    const other = "b".repeat(64)
    queueSessionRevocation(raw)
    queueSessionRevocation(other)
    global.fetch = jest.fn().mockRejectedValue(new TypeError("offline"))
    await flushRevocationOutbox()
    await flushRevocationOutbox()
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(localStorage.length).toBe(2)
    jest.setSystemTime(Date.now() + 8 * 86400_000)
    await flushRevocationOutbox()
    expect(localStorage.length).toBe(0)
})

test("at most twenty bounded proofs remain and raw refresh tokens never enter queued records", () => {
    for (let index = 1; index <= 25; index += 1) queueSessionRevocation(index.toString(16).padStart(64, "0"))
    expect(localStorage.length).toBe(20)
    for (let index = 0; index < localStorage.length; index += 1) {
        const record = JSON.parse(localStorage.getItem(localStorage.key(index)!)!)
        expect(Object.keys(record).sort()).toEqual(["attempts", "createdAt", "lastAttemptAt", "refreshTokenHash"])
    }
})
