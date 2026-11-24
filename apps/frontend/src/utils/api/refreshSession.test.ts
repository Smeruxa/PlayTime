const mockRevoke = jest.fn<Promise<void>, unknown[]>(async () => {})
const mockConsumed = new Set<string>()
const mockWasConsumed = jest.fn(async (token: string) => mockConsumed.has(token))
const mockRememberConsumed = jest.fn(async (token: string) => {
    mockConsumed.add(token)
})
jest.mock("../../config", () => ({ API_BASE: "https://api.example.test/playtime" }))
jest.mock("./revokeSession", () => ({ revokeSession: (...args: unknown[]) => mockRevoke(...args) }))
jest.mock("./refreshHandoff", () => ({
    wasRefreshConsumed: (token: string) => mockWasConsumed(token),
    rememberConsumedRefresh: (token: string) => mockRememberConsumed(token),
    refreshRequestKey: async () => "a".repeat(64)
}))

const originalFetch = global.fetch
const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks")
const mockFetch = jest.fn()
const sid = "11111111-1111-4111-8111-111111111111"
const otherSid = "22222222-2222-4222-8222-222222222222"

function token(id = 1, sessionId = sid, revision = 0, expires = Math.floor(Date.now() / 1000) + 900) {
    return `header.${btoa(JSON.stringify({ id, username: `user${id}`, sid: sessionId, exp: expires, revision }))}.signature`
}
function pair(access = token(), refresh = "old-refresh") {
    localStorage.setItem("token", access)
    localStorage.setItem("refreshToken", refresh)
}
function response(access = token(1, sid, 1), refresh = "new-refresh"): Response {
    return {
        ok: true,
        json: async () => ({
            token: access,
            refreshToken: refresh,
            expiresIn: 900,
            user: { id: 1, username: "user1", email: null, isGuest: true }
        })
    } as Response
}
function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((complete) => {
        resolve = complete
    })
    return { promise, resolve }
}
function isolatedTab() {
    let module!: typeof import("./refreshSession")
    jest.isolateModules(() => {
        module = require("./refreshSession")
    })
    return module
}
function installLocks() {
    let tail: Promise<unknown> = Promise.resolve()
    const request = jest.fn(
        (name: string, options: LockOptions | (() => Promise<unknown>), callback?: () => Promise<unknown>) => {
            expect(name).toBe("playtime:auth-refresh")
            const run = typeof options === "function" ? options : callback!
            const signal = typeof options === "function" ? undefined : options.signal
            const result = tail.then(() => {
                signal?.throwIfAborted()
                return run()
            })
            tail = result.catch(() => {})
            if (!signal) return result
            return new Promise((resolve, reject) => {
                const cancel = () => reject(new DOMException("Aborted", "AbortError"))
                signal.addEventListener("abort", cancel, { once: true })
                result.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel))
            })
        }
    )
    Object.defineProperty(navigator, "locks", { value: { request }, configurable: true })
    return request
}
const tick = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve()
}

beforeEach(() => {
    mockConsumed.clear()
    mockWasConsumed.mockClear()
    mockRememberConsumed.mockClear()
    mockRevoke.mockClear()
    mockFetch.mockReset()
    global.fetch = mockFetch
    localStorage.clear()
    pair()
    installLocks()
})
afterEach(() => {
    jest.useRealTimers()
    global.fetch = originalFetch
    if (originalLocks) Object.defineProperty(navigator, "locks", originalLocks)
    else Reflect.deleteProperty(navigator, "locks")
    localStorage.clear()
})

test("two isolated tabs rotate once and both receive the pair saved before releasing the lock", async () => {
    const firstTab = isolatedTab(),
        secondTab = isolatedTab()
    const network = deferred<Response>()
    mockFetch.mockReturnValueOnce(network.promise)
    const first = firstTab.refreshSession("old-refresh")
    const second = secondTab.refreshSession("old-refresh")
    await tick()
    expect(mockFetch).toHaveBeenCalledTimes(1)
    network.resolve(response())
    const [a, b] = await Promise.all([first, second])
    expect(a.token).toBe(b.token)
    expect(a.refreshToken).toBe(b.refreshToken)
    expect(localStorage.getItem("token")).toBe(a.token)
    expect(localStorage.getItem("refreshToken")).toBe("new-refresh")
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockRevoke).not.toHaveBeenCalled()
})

test.each([false, true])(
    "a queued refresh cannot adopt a different login, even for the same user (same user: %s)",
    async (sameUser) => {
        const held = deferred<void>()
        const request = installLocks()
        const blocker = request("playtime:auth-refresh", () => held.promise)
        const tab = isolatedTab()
        const refreshing = tab.refreshSession("old-refresh")
        const newAccess = token(sameUser ? 1 : 2, otherSid)
        pair(newAccess, "different-login-refresh")
        held.resolve()
        await blocker
        await expect(refreshing).rejects.toMatchObject({ status: 409 })
        expect(mockFetch).not.toHaveBeenCalled()
        expect(mockRevoke).not.toHaveBeenCalled()
        expect(localStorage.getItem("token")).toBe(newAccess)
    }
)

test.each([false, true])(
    "logout during rotation cannot be undone by a late response (new login: %s)",
    async (newLogin) => {
        const tab = isolatedTab()
        const network = deferred<Response>()
        mockFetch.mockReturnValueOnce(network.promise)
        const refreshing = tab.refreshSession("old-refresh")
        await tick()
        localStorage.clear()
        const replacement = token(1, otherSid)
        if (newLogin) pair(replacement, "different-login-refresh")
        const late = token(1, sid, 1)
        network.resolve(response(late, "late-refresh"))
        await expect(refreshing).rejects.toMatchObject({ status: 409 })
        expect(mockRevoke).toHaveBeenCalledWith(late, "late-refresh")
        expect(localStorage.getItem("token")).toBe(newLogin ? replacement : null)
        expect(localStorage.getItem("refreshToken")).toBe(newLogin ? "different-login-refresh" : null)
    }
)

test("an explicit server revocation is never converted into a successful stored-token reuse", async () => {
    const tab = isolatedTab()
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: "Session revoked" }) })
    await expect(tab.refreshSession("old-refresh")).rejects.toMatchObject({ status: 401 })
    expect(localStorage.getItem("refreshToken")).toBe("old-refresh")
    expect(mockRevoke).not.toHaveBeenCalled()
})

test("transient errors release the lock and leave the stored pair available for retry", async () => {
    const tab = isolatedTab()
    mockFetch.mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(response())
    await expect(tab.refreshSession("old-refresh")).rejects.toThrow("offline")
    expect(localStorage.getItem("refreshToken")).toBe("old-refresh")
    await expect(tab.refreshSession("old-refresh")).resolves.toMatchObject({ refreshToken: "new-refresh" })
    expect(localStorage.getItem("refreshToken")).toBe("new-refresh")
})

test("a failed handoff write after server rotation cannot discard the valid replacement credentials", async () => {
    const tab = isolatedTab()
    mockFetch.mockResolvedValueOnce(response())
    mockRememberConsumed.mockRejectedValueOnce(new Error("IndexedDB quota exceeded"))
    await expect(tab.refreshSession("old-refresh")).resolves.toMatchObject({
        refreshToken: "new-refresh",
        persisted: true
    })
    expect(localStorage.getItem("refreshToken")).toBe("new-refresh")
    expect(localStorage.getItem("token")).toBe(token(1, sid, 1))
    expect(mockRevoke).not.toHaveBeenCalled()
})

test("browsers without Web Locks retain per-tab deduplication and leave persistence to the caller", async () => {
    Object.defineProperty(navigator, "locks", { value: undefined, configurable: true })
    const tab = isolatedTab()
    const network = deferred<Response>()
    mockFetch.mockReturnValueOnce(network.promise)
    const first = tab.refreshSession("old-refresh")
    const second = tab.refreshSession("old-refresh")
    expect(first).toBe(second)
    network.resolve(response())
    await Promise.all([first, second])
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem("refreshToken")).toBe("old-refresh")
})

test("a renderer with a stale localStorage cache waits for handoff instead of replaying a consumed refresh token", async () => {
    const oldAccess = token()
    const updatedAccess = token(1, sid, 1)
    mockConsumed.add("old-refresh")
    const tab = isolatedTab()
    const refreshing = tab.refreshSession("old-refresh")
    await tick()
    expect(localStorage.getItem("token")).toBe(oldAccess)
    expect(mockFetch).not.toHaveBeenCalled()
    pair(updatedAccess, "already-rotated-refresh")
    window.dispatchEvent(new StorageEvent("storage", { key: "refreshToken", storageArea: localStorage }))
    await expect(refreshing).resolves.toMatchObject({
        token: updatedAccess,
        refreshToken: "already-rotated-refresh",
        persisted: true
    })
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockRevoke).not.toHaveBeenCalled()
})

test("logout remains final while a stale renderer waits for its consumed-token handoff", async () => {
    mockConsumed.add("old-refresh")
    const refreshing = isolatedTab().refreshSession("old-refresh")
    await tick()
    localStorage.clear()
    window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage }))
    await expect(refreshing).rejects.toMatchObject({ status: 409 })
    expect(localStorage.getItem("token")).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
})

test("missing storage propagation times out without posting or erasing a consumed credential", async () => {
    jest.useFakeTimers()
    mockConsumed.add("old-refresh")
    const refreshing = isolatedTab().refreshSession("old-refresh")
    const rejection = expect(refreshing).rejects.toMatchObject({ status: 409 })
    await tick()
    await jest.advanceTimersByTimeAsync(5001)
    await rejection
    expect(mockFetch).not.toHaveBeenCalled()
    expect(localStorage.getItem("refreshToken")).toBe("old-refresh")
})

test("a hung response body times out, releases the lock and keeps its proof available for retry", async () => {
    jest.useFakeTimers()
    const body = deferred<unknown>()
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => body.promise }).mockResolvedValueOnce(response())
    const tab = isolatedTab()
    const first = tab.refreshSession("old-refresh")
    const timedOut = expect(first).rejects.toThrow("вовремя")
    await jest.advanceTimersByTimeAsync(12_001)
    await timedOut
    expect(localStorage.getItem("refreshToken")).toBe("old-refresh")
    await expect(tab.refreshSession("old-refresh")).resolves.toMatchObject({ refreshToken: "new-refresh" })
    const bodies = mockFetch.mock.calls.map(([, init]) => JSON.parse(init.body))
    expect(bodies[0].requestKey).toBe(bodies[1].requestKey)
    body.resolve({ token: token(1, sid, 2), refreshToken: "obsolete-late-refresh" })
    await tick()
    expect(localStorage.getItem("refreshToken")).toBe("new-refresh")
})

test("waiting for another tab's lock has a deadline and a cancelled waiter never runs later", async () => {
    jest.useFakeTimers()
    const held = deferred<void>()
    const locks = installLocks()
    const blocker = locks("playtime:auth-refresh", () => held.promise)
    const tab = isolatedTab()
    const request = tab.refreshSession("old-refresh")
    const timedOut = expect(request).rejects.toThrow("вовремя")
    await jest.advanceTimersByTimeAsync(5001)
    await timedOut
    held.resolve()
    await blocker
    await tick()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(localStorage.getItem("refreshToken")).toBe("old-refresh")
    mockFetch.mockResolvedValueOnce(response())
    await expect(tab.refreshSession("old-refresh")).resolves.toMatchObject({ refreshToken: "new-refresh" })
})
