import { restoreStoredSession } from "./restoreStoredSession"
import { tokenValid } from "./tokenValid"
import { AuthRequestError, refreshSession } from "./refreshSession"
import { revokeSession } from "./revokeSession"
jest.mock("./tokenValid", () => ({ tokenValid: jest.fn() }))
jest.mock("./revokeSession", () => ({ revokeSession: jest.fn(async () => {}) }))
jest.mock("./refreshSession", () => {
    const actual = jest.requireActual("./refreshSession")
    return { ...actual, refreshSession: jest.fn() }
})
beforeEach(() => {
    jest.resetAllMocks()
    localStorage.clear()
    localStorage.setItem("token", "old-access")
    localStorage.setItem("refreshToken", "old-refresh")
})
it("preserves both credentials on network failure, then recovers on retry", async () => {
    ;(tokenValid as jest.Mock).mockRejectedValue(new TypeError("offline"))
    ;(refreshSession as jest.Mock).mockRejectedValue(new AuthRequestError("Unavailable", 503))
    await expect(restoreStoredSession()).rejects.toThrow("Unavailable")
    expect(localStorage.getItem("token")).toBe("old-access")
    expect(localStorage.getItem("refreshToken")).toBe("old-refresh")
    ;(refreshSession as jest.Mock).mockResolvedValue({ token: "new-access", refreshToken: "new-refresh" })
    expect(await restoreStoredSession()).toBe("new-access")
    expect(localStorage.getItem("refreshToken")).toBe("new-refresh")
})
it("clears revoked credentials only after an explicit auth rejection", async () => {
    ;(tokenValid as jest.Mock).mockRejectedValue(new AuthRequestError("Expired", 401))
    ;(refreshSession as jest.Mock).mockRejectedValue(new AuthRequestError("Revoked", 403))
    expect(await restoreStoredSession()).toBeNull()
    expect(localStorage.getItem("refreshToken")).toBeNull()
})
it("can recover from a refresh token without an access token", async () => {
    localStorage.removeItem("token")
    ;(refreshSession as jest.Mock).mockResolvedValue({ token: "restored", refreshToken: "rotated" })
    expect(await restoreStoredSession()).toBe("restored")
})

it.each([false, true])("does not persist a delayed refresh after logout (new login: %s)", async (newLogin) => {
    localStorage.removeItem("token")
    let complete!: (value: { token: string; refreshToken: string }) => void
    ;(refreshSession as jest.Mock).mockReturnValueOnce(
        new Promise((resolve) => {
            complete = resolve
        })
    )
    const restoring = restoreStoredSession()
    localStorage.removeItem("refreshToken")
    if (newLogin) {
        localStorage.setItem("token", "different-account-access")
        localStorage.setItem("refreshToken", "different-account-refresh")
    }
    complete({ token: "late-access", refreshToken: "late-refresh" })
    expect(await restoring).toBe(newLogin ? "different-account-access" : null)
    expect(localStorage.getItem("token")).toBe(newLogin ? "different-account-access" : null)
    expect(localStorage.getItem("refreshToken")).toBe(newLogin ? "different-account-refresh" : null)
    expect(revokeSession).toHaveBeenCalledWith("late-access", "late-refresh")
})

it.each([false, true])("keeps a new login when old validation completes (rejected: %s)", async (rejected) => {
    let complete!: (value: { valid: boolean }) => void
    let reject!: (error: Error) => void
    ;(tokenValid as jest.Mock).mockReturnValueOnce(
        new Promise((resolve, rejectPromise) => {
            complete = resolve
            reject = rejectPromise
        })
    )
    const restoring = restoreStoredSession()
    localStorage.setItem("token", "different-account-access")
    localStorage.setItem("refreshToken", "different-account-refresh")
    if (rejected) reject(new AuthRequestError("Old access revoked", 401))
    else complete({ valid: true })
    expect(await restoring).toBe("different-account-access")
    expect(localStorage.getItem("token")).toBe("different-account-access")
    expect(localStorage.getItem("refreshToken")).toBe("different-account-refresh")
    expect(refreshSession).not.toHaveBeenCalled()
})

it("keeps new credentials when an old refresh is rejected", async () => {
    localStorage.removeItem("token")
    let reject!: (error: Error) => void
    ;(refreshSession as jest.Mock).mockReturnValueOnce(
        new Promise((_resolve, rejectPromise) => {
            reject = rejectPromise
        })
    )
    const restoring = restoreStoredSession()
    localStorage.setItem("token", "different-account-access")
    localStorage.setItem("refreshToken", "different-account-refresh")
    reject(new AuthRequestError("Old refresh revoked", 403))
    expect(await restoring).toBe("different-account-access")
    expect(localStorage.getItem("token")).toBe("different-account-access")
    expect(localStorage.getItem("refreshToken")).toBe("different-account-refresh")
})

it("does not revoke the shared refresh result of concurrent startup restores", async () => {
    localStorage.removeItem("token")
    let complete!: (value: { token: string; refreshToken: string }) => void
    const pending = new Promise((resolve) => {
        complete = resolve
    })
    ;(refreshSession as jest.Mock).mockReturnValue(pending)
    const restores = [restoreStoredSession(), restoreStoredSession()]
    complete({ token: "restored-access", refreshToken: "restored-refresh" })
    expect(await Promise.all(restores)).toEqual(["restored-access", "restored-access"])
    expect(localStorage.getItem("token")).toBe("restored-access")
    expect(localStorage.getItem("refreshToken")).toBe("restored-refresh")
    expect(revokeSession).not.toHaveBeenCalled()
})

it("does not let the validation transport delete credentials from another login", async () => {
    const actualTokenValid = jest.requireActual<typeof import("./tokenValid")>("./tokenValid").tokenValid
    const previousFetch = globalThis.fetch
    let complete!: (response: Response) => void
    globalThis.fetch = jest.fn(
        () =>
            new Promise<Response>((resolve) => {
                complete = resolve
            })
    )
    try {
        const validating = actualTokenValid("old-access")
        localStorage.setItem("token", "different-account-access")
        complete({ ok: false, status: 401, json: async () => ({ error: "Old access expired" }) } as Response)
        await expect(validating).rejects.toThrow("Old access expired")
        expect(localStorage.getItem("token")).toBe("different-account-access")
    } finally {
        globalThis.fetch = previousFetch
    }
})

it("adopts a newer rotation of the same device instead of revoking it when an older refresh returns", async () => {
    const token = (revision: number) =>
        `header.${btoa(JSON.stringify({ id: 1, sid: "same-device", revision }))}.signature`
    localStorage.setItem("token", token(0))
    ;(tokenValid as jest.Mock).mockRejectedValueOnce(new AuthRequestError("Expired", 401))
    let complete!: (value: { token: string; refreshToken: string }) => void
    ;(refreshSession as jest.Mock).mockReturnValueOnce(
        new Promise((resolve) => {
            complete = resolve
        })
    )
    const restoring = restoreStoredSession()
    await Promise.resolve()
    localStorage.setItem("token", token(2))
    localStorage.setItem("refreshToken", "latest-refresh")
    complete({ token: token(1), refreshToken: "intermediate-refresh" })
    expect(await restoring).toBe(token(2))
    expect(localStorage.getItem("refreshToken")).toBe("latest-refresh")
    expect(revokeSession).not.toHaveBeenCalled()
})
