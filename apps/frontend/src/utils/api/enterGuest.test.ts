const mockProofs = new Map<string, { requestKey: string; retired?: boolean }>()
let mockNextProof = 0
let mockRetirementFailure = false
jest.mock("../../config", () => ({ API_BASE: "/playtime" }))
jest.mock("./refreshHandoff", () => ({
    guestRequestKey: async (username: string, previous?: string) => {
        const existing = mockProofs.get(username)
        if (!existing || existing.retired)
            mockProofs.set(username, {
                requestKey: (!existing?.retired && previous) || (++mockNextProof).toString(16).padStart(64, "0")
            })
        return mockProofs.get(username)!.requestKey
    },
    retireGuestRequest: async (username: string, requestKey: string) => {
        if (mockRetirementFailure) throw new Error("retirement unavailable")
        const existing = mockProofs.get(username)
        if (!existing || existing.requestKey === requestKey) mockProofs.set(username, { requestKey, retired: true })
    },
    publishGuestRequest: async (username: string, requestKey: string, publish: () => void, retired: () => void) => {
        const existing = mockProofs.get(username)
        if (existing?.requestKey !== requestKey || existing.retired) throw new Error("Вход отменён")
        publish()
        if (!mockRetirementFailure) {
            mockProofs.set(username, { requestKey, retired: true })
            retired()
        }
    }
}))
const savedFetch = global.fetch
const fetchMock = jest.fn()
const success = () => ({ ok: true, json: async () => ({ token: "access", refreshToken: "refresh" }) })
const api = () => require("./enterGuest") as typeof import("./enterGuest")
beforeEach(() => {
    localStorage.clear()
    mockProofs.clear()
    mockNextProof = 0
    mockRetirementFailure = false
    fetchMock.mockReset()
    global.fetch = fetchMock
})
afterEach(() => {
    global.fetch = savedFetch
    jest.useRealTimers()
})

test("a lost creation response can recover the same guest after reloading the module", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("connection dropped after commit")).mockResolvedValueOnce(success())
    await expect(api().enterGuest("moonwalker")).rejects.toThrow("connection dropped")
    const first = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(api().pendingGuest()?.username).toBe("moonwalker")
    jest.resetModules()
    expect(api().pendingGuest()?.username).toBe("moonwalker")
    await expect(api().enterGuest("moonwalker")).resolves.toBe("access")
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body)).toEqual(first)
    expect(localStorage.getItem("refreshToken")).toBe("refresh")
    expect(api().pendingGuest()).toBeNull()
})

test("a transport that ignores cancellation cannot overwrite a later login", async () => {
    let deliver!: (value: unknown) => void
    fetchMock.mockReturnValueOnce(
        new Promise((resolve) => {
            deliver = resolve
        })
    )
    const controller = new AbortController()
    const request = api().enterGuest("moonwalker", controller.signal)
    const cancelled = expect(request).rejects.toMatchObject({ name: "AbortError" })
    for (let i = 0; i < 8; i++) await Promise.resolve()
    controller.abort()
    await cancelled
    localStorage.setItem("token", "new-login")
    localStorage.setItem("refreshToken", "new-login-refresh")
    deliver(success())
    for (let i = 0; i < 8; i++) await Promise.resolve()
    expect(localStorage.getItem("token")).toBe("new-login")
    expect(api().pendingGuest()?.username).toBe("moonwalker")
})

test("a hung guest request releases the form and retries with the saved proof", async () => {
    jest.useFakeTimers()
    fetchMock.mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce(success())
    const request = api().enterGuest("moonwalker")
    const timedOut = expect(request).rejects.toThrow("вовремя")
    await jest.advanceTimersByTimeAsync(12_001)
    await timedOut
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    await expect(api().enterGuest("moonwalker")).resolves.toBe("access")
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(JSON.parse(fetchMock.mock.calls[0][1].body))
})

test("a guest response cannot overwrite a login completed in another tab", async () => {
    fetchMock.mockImplementationOnce(async () => {
        localStorage.setItem("token", "another-account")
        localStorage.setItem("refreshToken", "another-refresh")
        return success()
    })
    await expect(api().enterGuest("moonwalker")).rejects.toThrow("другой вкладке")
    expect(localStorage.getItem("token")).toBe("another-account")
})

test("failure to persist a retry proof prevents the guest creation request", async () => {
    const spy = jest.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
        throw new Error("storage unavailable")
    })
    try {
        await expect(api().enterGuest("moonwalker")).rejects.toThrow("storage unavailable")
        expect(fetchMock).not.toHaveBeenCalled()
    } finally {
        spy.mockRestore()
    }
})

test("successful guest publication retires its proof even if a later remote logout is offline", async () => {
    fetchMock
        .mockResolvedValueOnce(success())
        .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Никнейм занят" }) })
    await api().enterGuest("moonwalker")
    const old = JSON.parse(fetchMock.mock.calls[0][1].body)
    localStorage.clear()
    await expect(api().enterGuest("moonwalker")).rejects.toThrow("занят")
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).requestKey).not.toBe(old.requestKey)
    expect(localStorage.getItem("token")).toBeNull()
})

test("a stale pending envelope cannot reinstate a proof retired by another tab", async () => {
    fetchMock
        .mockResolvedValueOnce(success())
        .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Никнейм занят" }) })
    await api().enterGuest("moonwalker")
    const old = JSON.parse(fetchMock.mock.calls[0][1].body)
    localStorage.clear()
    localStorage.setItem("playtime:pending-guest", JSON.stringify(old))
    await expect(api().enterGuest("moonwalker")).rejects.toThrow("занят")
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).requestKey).not.toBe(old.requestKey)
})

test("retirement failure after publication preserves the pair and persists a fail-closed fallback", async () => {
    mockRetirementFailure = true
    fetchMock.mockResolvedValueOnce(success())
    await expect(api().enterGuest("moonwalker")).resolves.toBe("access")
    expect(localStorage.getItem("token")).toBe("access")
    expect(api().pendingGuest()).toBeNull()
    expect(JSON.parse(localStorage.getItem("playtime:pending-guest")!).retired).toBe(true)
    localStorage.removeItem("token")
    localStorage.removeItem("refreshToken")
    await expect(api().enterGuest("moonwalker")).rejects.toThrow("retirement unavailable")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    mockRetirementFailure = false
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Никнейм занят" }) })
    await expect(api().enterGuest("moonwalker")).rejects.toThrow("занят")
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).requestKey).not.toBe(
        JSON.parse(fetchMock.mock.calls[0][1].body).requestKey
    )
})

test("explicit abandonment retires recovery and prevents a late response from publishing", async () => {
    let deliver!: (value: unknown) => void
    fetchMock.mockReturnValueOnce(
        new Promise((resolve) => {
            deliver = resolve
        })
    )
    const request = api().enterGuest("moonwalker")
    const rejected = expect(request).rejects.toThrow("отменён")
    for (let i = 0; i < 8; i++) await Promise.resolve()
    await api().abandonPendingGuest()
    expect(api().pendingGuest()).toBeNull()
    deliver(success())
    await rejected
    expect(localStorage.getItem("token")).toBeNull()
    expect(localStorage.getItem("refreshToken")).toBeNull()
})

test("changing nickname abandons the earlier interrupted creation proof", async () => {
    fetchMock.mockRejectedValueOnce(new Error("connection dropped")).mockRejectedValueOnce(new Error("connection dropped"))
    await expect(api().enterGuest("old_name")).rejects.toThrow("connection dropped")
    const old = JSON.parse(fetchMock.mock.calls[0][1].body)
    await expect(api().enterGuest("new_name")).rejects.toThrow("connection dropped")
    expect(mockProofs.get("old_name")?.retired).toBe(true)
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Никнейм занят" }) })
    await expect(api().enterGuest("old_name")).rejects.toThrow("занят")
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).requestKey).not.toBe(old.requestKey)
})
