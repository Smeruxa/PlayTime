import { act, renderHook } from "@testing-library/react"
import type { Socket } from "socket.io-client"
import { useOutgoingCallTimeout } from "./useOutgoingCallTimeout"

function setup() {
    const listeners = new Map<string, (data: unknown) => void>()
    const socket = {
        on: jest.fn((event, listener) => listeners.set(event, listener)),
        off: jest.fn((event) => listeners.delete(event)),
        emit: jest.fn()
    }
    const onClose = jest.fn()
    const suppressEndedCloseRef = { current: false }
    const args = {
        socket: socket as unknown as Socket,
        roomId: "1:2",
        ownershipRevision: 1,
        peerName: "Alice",
        enabled: true,
        callRef: { current: null },
        suppressEndedCloseRef,
        setCallState: jest.fn(),
        onClose
    }
    const view = renderHook((props) => useOutgoingCallTimeout(props), { initialProps: args })
    return {
        ...view,
        args,
        socket,
        onClose,
        receive: (data: unknown) => act(() => listeners.get("call:noAnswer")?.(data))
    }
}

beforeEach(() => {
    jest.useFakeTimers()
    jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue()
})

afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
})

test("a delayed no-answer close is canceled when another device transfers the call back", () => {
    const { receive, rerender, args, onClose, socket } = setup()
    receive({ roomId: args.roomId, ownershipRevision: 1 })
    expect(socket.emit).toHaveBeenCalledWith("call:end", { roomId: args.roomId, ownershipRevision: 1 })
    rerender({ ...args, ownershipRevision: 3 })
    act(() => jest.advanceTimersByTime(2200))
    expect(onClose).not.toHaveBeenCalled()
    expect(args.suppressEndedCloseRef.current).toBe(false)
})

test("unmount cancels the delayed close and old epochs cannot start it", () => {
    const { receive, unmount, args, onClose, socket } = setup()
    receive({ roomId: args.roomId, ownershipRevision: 0 })
    receive({ roomId: "old-room", ownershipRevision: 1 })
    expect(socket.emit).not.toHaveBeenCalled()
    receive({ roomId: args.roomId, ownershipRevision: 1 })
    unmount()
    act(() => jest.advanceTimersByTime(2200))
    expect(onClose).not.toHaveBeenCalled()
})

test("the current owner closes after displaying no answer", () => {
    const { receive, args, onClose } = setup()
    receive({ roomId: args.roomId, ownershipRevision: 1 })
    expect(onClose).not.toHaveBeenCalled()
    act(() => jest.advanceTimersByTime(2200))
    expect(onClose).toHaveBeenCalledTimes(1)
})
