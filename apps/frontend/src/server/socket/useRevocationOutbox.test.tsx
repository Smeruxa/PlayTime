import { act, renderHook } from "@testing-library/react"
import { useRevocationOutbox } from "./useRevocationOutbox"
import { flushRevocationOutbox } from "../../utils/api/revocationOutbox"
jest.mock("../../utils/api/revocationOutbox", () => ({ flushRevocationOutbox: jest.fn(async () => {}) }))

test("startup and online retry independently of auth, with clean event and timer disposal", async () => {
    jest.useFakeTimers()
    const flush = flushRevocationOutbox as jest.Mock
    flush.mockClear()
    const { rerender, unmount } = renderHook(() => useRevocationOutbox())
    await act(async () => {})
    expect(flush).toHaveBeenCalledTimes(1)
    rerender()
    expect(flush).toHaveBeenCalledTimes(1)
    await act(async () => {
        window.dispatchEvent(new Event("online"))
    })
    expect(flush).toHaveBeenCalledTimes(2)
    await act(async () => {
        jest.advanceTimersByTime(60_000)
    })
    expect(flush).toHaveBeenCalledTimes(3)
    unmount()
    await act(async () => {
        window.dispatchEvent(new Event("online"))
        jest.advanceTimersByTime(120_000)
    })
    expect(flush).toHaveBeenCalledTimes(3)
    jest.useRealTimers()
})
