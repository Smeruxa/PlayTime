jest.mock("../../config", () => ({ API_BASE: "/playtime" }))
import { revokeSession } from "./revokeSession"
import { REVOCATION_OUTBOX_KEY } from "./revocationOutbox"
const previousFetch = global.fetch
const fetchMock = jest.fn()
const consumedRefresh = "a".repeat(64)
const consumedHash = "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb"
const proofKey = `${REVOCATION_OUTBOX_KEY}:${consumedHash}`
beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    global.fetch = fetchMock
})
afterEach(() => {
    global.fetch = previousFetch
    jest.useRealTimers()
    jest.restoreAllMocks()
})

test("logout sends the consumed refresh hash as a revoke-only receipt capability despite expired access", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true })
    const request = revokeSession("expired-access", consumedRefresh)
    expect(localStorage.getItem(proofKey)).toContain(consumedHash)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ refreshTokenHash: consumedHash })
    await request
    expect(localStorage.getItem(proofKey)).toBeNull()
})

test("a legacy access/device session can still revoke without a valid refresh credential", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true })
    await revokeSession("valid-access", "invalid-refresh")
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: "valid-access" })
    expect(localStorage.length).toBe(0)
})

test("an unresponsive revocation transport has a deadline and retains its durable retry proof", async () => {
    jest.useFakeTimers()
    fetchMock.mockReturnValueOnce(new Promise(() => {}))
    const request = revokeSession("expired-access", consumedRefresh)
    await jest.advanceTimersByTimeAsync(12_001)
    await expect(request).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    expect(localStorage.getItem(proofKey)).not.toBeNull()
})
