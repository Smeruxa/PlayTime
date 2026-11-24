import { act, renderHook } from "@testing-library/react"
import { AccountStatusProvider, useAccountStatus, type AccountStatus } from "./AccountStatus"
import { useSessionSocket } from "../server/socketContext"
import { tokenValid } from "../utils/api"

jest.mock("../server/socketContext", () => ({ useSessionSocket: jest.fn() }))
jest.mock("../utils/api", () => ({ tokenValid: jest.fn() }))

const guest: AccountStatus = {
    id: 1,
    username: "guest",
    email: "guest@example.test",
    isGuest: true,
    registrationPending: true
}
const registered: AccountStatus = { ...guest, isGuest: false, registrationPending: false }
const other: AccountStatus = {
    id: 2,
    username: "member",
    email: "member@example.test",
    isGuest: false,
    registrationPending: false
}
type StatusResponse = { valid: boolean; user: AccountStatus }

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason: Error) => void
    const promise = new Promise<T>((onResolve, onReject) => {
        resolve = onResolve
        reject = onReject
    })
    return { promise, resolve, reject }
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AccountStatusProvider>{children}</AccountStatusProvider>
)

beforeEach(() => {
    jest.resetAllMocks()
    ;(useSessionSocket as jest.Mock).mockReturnValue({ token: "guest-token" })
})

test("a pre-confirmation response cannot restore the guest reminder after registration finishes", async () => {
    const beforeConfirmation = deferred<StatusResponse>()
    const afterConfirmation = deferred<StatusResponse>()
    ;(tokenValid as jest.Mock)
        .mockReturnValueOnce(beforeConfirmation.promise)
        .mockReturnValueOnce(afterConfirmation.promise)
    const { result } = renderHook(useAccountStatus, { wrapper })
    let refresh!: Promise<void>
    act(() => {
        refresh = result.current.reloadAccount()
    })
    await act(async () => {
        afterConfirmation.resolve({ valid: true, user: registered })
        await refresh
    })
    expect(result.current.account).toEqual(registered)
    await act(async () => {
        beforeConfirmation.resolve({ valid: true, user: guest })
        await beforeConfirmation.promise
    })
    expect(result.current.account).toEqual(registered)
})

test("a late response for the previous session cannot hide or replace the newly signed-in account", async () => {
    const oldSession = deferred<StatusResponse>()
    const newSession = deferred<StatusResponse>()
    ;(tokenValid as jest.Mock).mockReturnValueOnce(oldSession.promise).mockReturnValueOnce(newSession.promise)
    const { result, rerender } = renderHook(useAccountStatus, { wrapper })
    ;(useSessionSocket as jest.Mock).mockReturnValue({ token: "member-token" })
    rerender()
    await act(async () => {
        newSession.resolve({ valid: true, user: other })
        await newSession.promise
    })
    expect(result.current.account).toEqual(other)
    await act(async () => {
        oldSession.resolve({ valid: true, user: guest })
        await oldSession.promise
    })
    expect(result.current.account).toEqual(other)
})

test("logout immediately removes account data and ignores pending validation", async () => {
    const late = deferred<StatusResponse>()
    ;(tokenValid as jest.Mock).mockResolvedValueOnce({ valid: true, user: guest }).mockReturnValueOnce(late.promise)
    const { result, rerender } = renderHook(useAccountStatus, { wrapper })
    await act(async () => {})
    expect(result.current.account).toEqual(guest)
    let refresh!: Promise<void>
    act(() => {
        refresh = result.current.reloadAccount()
    })
    ;(useSessionSocket as jest.Mock).mockReturnValue({ token: null })
    rerender()
    expect(result.current.account).toBeNull()
    await act(async () => {
        late.resolve({ valid: true, user: guest })
        await refresh
    })
    expect(result.current.account).toBeNull()
    expect(tokenValid).toHaveBeenCalledTimes(2)
})

test("an offline status refresh preserves the last known account and remains retryable", async () => {
    ;(tokenValid as jest.Mock)
        .mockResolvedValueOnce({ valid: true, user: guest })
        .mockRejectedValueOnce(new TypeError("offline"))
        .mockResolvedValueOnce({ valid: true, user: registered })
    const { result } = renderHook(useAccountStatus, { wrapper })
    await act(async () => {})
    await act(async () => {
        await expect(result.current.reloadAccount()).rejects.toThrow("offline")
    })
    expect(result.current.account).toEqual(guest)
    await act(async () => {
        await result.current.reloadAccount()
    })
    expect(result.current.account).toEqual(registered)
})
