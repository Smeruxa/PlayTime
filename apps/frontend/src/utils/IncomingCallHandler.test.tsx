import { act, fireEvent, render, screen } from "@testing-library/react"
import { EventEmitter } from "events"
import type { IncomingCallAnswer } from "../features/call/incomingCallWindowTypes"
import IncomingCallHandler from "./IncomingCallHandler"
import { callFromState, mergeDirectCall, type DirectCallState } from "./directCallState"

let mockSocket: EventEmitter & { connected: boolean; timeout: jest.Mock }
let active: any = null
const mockNavigate = jest.fn()
const mockSetActiveCall = jest.fn((update) => {
    active = typeof update === "function" ? update(active) : update
})
jest.mock("react-router-dom", () => ({ useNavigate: () => mockNavigate }))
jest.mock("../server/socketContext", () => ({
    useSessionSocket: () => ({ socket: mockSocket, myUserId: 2, myName: "Bob" }),
    useCallState: () => ({ setActiveCall: mockSetActiveCall })
}))
jest.mock("../components/ModalWindow/ModalWindow", () => ({
    __esModule: true,
    default: ({ call }: any) => <div role="dialog">{call.from}</div>
}))
const state: DirectCallState = {
    roomId: "1:2:11111111-1111-4111-8111-111111111111",
    status: "request_receiver",
    revision: 1,
    caller: { id: 1, username: "Alice" },
    receiver: { id: 2, username: "Bob" }
}
beforeEach(() => {
    jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
    jest.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {})
    active = null
    mockSocket = new EventEmitter() as typeof mockSocket
    mockSocket.connected = true
    mockSocket.timeout = jest.fn(() => ({
        emit: (_event: string, callback: any) => {
            if (typeof callback === "function") callback(null, { state: null })
        }
    }))
    mockSetActiveCall.mockClear()
})

afterEach(() => {
    Reflect.deleteProperty(window, "electronAPI")
    Reflect.deleteProperty(window, "windowControls")
    jest.restoreAllMocks()
})

function mockDesktopCallWindow() {
    let listener: ((answer: IncomingCallAnswer) => void) | undefined
    const showIncomingCall = jest.fn()
    const hideIncomingCall = jest.fn()
    const focus = jest.fn()
    Object.defineProperty(window, "electronAPI", {
        configurable: true,
        value: {
            showIncomingCall,
            hideIncomingCall,
            onIncomingCallAnswer: (onAnswer: NonNullable<typeof listener>) => {
                listener = onAnswer
                return () => {
                    listener = undefined
                }
            }
        }
    })
    Object.defineProperty(window, "windowControls", { configurable: true, value: { focus } })
    return {
        showIncomingCall,
        hideIncomingCall,
        focus,
        answer: (accept: boolean, roomId = state.roomId) => listener?.({ roomId, accept })
    }
}

test("desktop presents the separate window immediately and fills the caller's profile when it arrives", () => {
    const desktop = mockDesktopCallWindow()
    let profileReply: ((response: unknown) => void) | undefined
    mockSocket.on("profile:get", (request, callback) => {
        expect(request).toEqual({ username: "Alice", peerUserId: 1 })
        profileReply = callback
    })
    render(<IncomingCallHandler />)
    act(() => mockSocket.emit("call:state", state))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(desktop.showIncomingCall).toHaveBeenLastCalledWith(
        expect.objectContaining({ from: "Alice", roomId: state.roomId })
    )
    act(() =>
        profileReply?.({
            profile: { userId: 1, avatar: "avatar", profileBanner: "banner", profileBannerEffect: "stars" }
        })
    )
    expect(desktop.showIncomingCall).toHaveBeenLastCalledWith(
        expect.objectContaining({ avatar: "avatar", profileBanner: "banner", profileBannerEffect: "stars" })
    )
    act(() => mockSocket.emit("call:ended", { roomId: state.roomId }))
    expect(desktop.hideIncomingCall).toHaveBeenCalledWith(state.roomId)
})

test("desktop waits for a successful answer, retries failures and focuses the accepted call after its state arrives", () => {
    const desktop = mockDesktopCallWindow()
    render(<IncomingCallHandler />)
    act(() => mockSocket.emit("call:state", state))
    const emit = jest.fn()
    mockSocket.timeout.mockReturnValue({ emit })
    act(() => {
        desktop.answer(true, "old-call")
        desktop.answer(true)
        desktop.answer(true)
    })
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenLastCalledWith("call:confirm", { roomId: state.roomId, accept: true }, expect.any(Function))
    expect(desktop.focus).not.toHaveBeenCalled()
    act(() => emit.mock.calls[0][2](new Error("timeout")))
    expect(desktop.showIncomingCall).toHaveBeenLastCalledWith(
        expect.objectContaining({ busy: false, error: expect.stringContaining("Не удалось ответить") })
    )
    act(() => desktop.answer(true))
    const inCall = { ...state, status: "in_call", revision: 2 }
    act(() => mockSocket.emit("call:state", inCall))
    expect(desktop.hideIncomingCall).toHaveBeenCalledWith(state.roomId)
    act(() => emit.mock.calls[1][2](null, { success: true, state: inCall }))
    expect(desktop.focus).toHaveBeenCalledTimes(1)
    expect(mockNavigate).toHaveBeenCalledWith("/content", { state: { name: "Alice", peerUserId: 1 } })
    expect(active).toMatchObject({ roomId: state.roomId, confirmed: true })
})

test("desktop ignores a late accept acknowledgement after cancellation and closes a declined call without focus", () => {
    const desktop = mockDesktopCallWindow()
    render(<IncomingCallHandler />)
    act(() => mockSocket.emit("call:state", state))
    const emit = jest.fn()
    mockSocket.timeout.mockReturnValue({ emit })
    act(() => desktop.answer(true))
    act(() => mockSocket.emit("call:ended", { roomId: state.roomId }))
    act(() => emit.mock.calls[0][2](null, { success: true }))
    expect(active).toBeNull()
    expect(desktop.focus).not.toHaveBeenCalled()
    const next = { ...state, roomId: "next-call" }
    act(() => mockSocket.emit("call:state", next))
    act(() => desktop.answer(false, next.roomId))
    expect(emit).toHaveBeenLastCalledWith("call:confirm", { roomId: next.roomId, accept: false }, expect.any(Function))
    act(() => emit.mock.calls[1][2](null, { success: true }))
    expect(desktop.hideIncomingCall).toHaveBeenLastCalledWith(next.roomId)
    expect(desktop.focus).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
})

test("a late ended event for another call cannot dismiss the incoming caller", () => {
    render(<IncomingCallHandler />)
    act(() => {
        mockSocket.emit("call:incomingCall", { from: "Alice", roomId: state.roomId })
    })
    expect(screen.getByRole("dialog")).toHaveTextContent("Alice")
    act(() => {
        mockSocket.emit("call:ended", { roomId: "old-call" })
    })
    expect(screen.getByRole("dialog")).toHaveTextContent("Alice")
    act(() => {
        mockSocket.emit("call:ended", { roomId: state.roomId })
    })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    act(() => {
        mockSocket.emit("call:incomingCall", { from: "Alice", roomId: state.roomId })
    })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
})

test("crossed calls converge to one confirmed call before the panel mounts", () => {
    render(<IncomingCallHandler />)
    act(() => {
        mockSocket.emit("call:state", state)
    })
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    act(() => {
        mockSocket.emit("call:state", { ...state, status: "in_call", revision: 2 })
    })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(active).toMatchObject({ roomId: state.roomId, confirmed: true, names: ["Alice", "Bob"] })
    act(() => {
        mockSocket.emit("call:state", state)
        mockSocket.emit("call:incomingCall", { from: "Alice", roomId: state.roomId })
    })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(active.confirmed).toBe(true)
})

test("reconnect recovers an incoming call missed during transport loss", () => {
    render(<IncomingCallHandler />)
    mockSocket.timeout.mockReturnValue({ emit: (_event: string, callback: any) => callback(null, { state }) })
    act(() => {
        mockSocket.emit("connect")
    })
    expect(screen.getByRole("dialog")).toHaveTextContent("Alice")
})

test("outgoing acknowledgements cannot downgrade an already confirmed session", () => {
    const confirmed = callFromState({ ...state, status: "in_call", revision: 2 }, 1)!
    expect(mergeDirectCall(confirmed, { ...confirmed, confirmed: false, revision: 1 })).toBe(confirmed)
    expect(callFromState(state, 999)).toBeNull()
})

const passive: DirectCallState = {
    ...state,
    status: "in_call",
    revision: 3,
    caller: { ...state.caller, ownershipRevision: 1 },
    receiver: { ...state.receiver, ownershipRevision: 2 },
    media: { active: false, canClaim: true, ownershipRevision: 2 }
}

test("a second device stays passive and claims only after an explicit click", () => {
    render(<IncomingCallHandler />)
    act(() => mockSocket.emit("call:state", passive))
    expect(active).toBeNull()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    const emit = jest.fn((_event, _request, reply) =>
        reply(null, {
            state: { ...passive, revision: 4, media: { ...passive.media, active: true, ownershipRevision: 3 } }
        })
    )
    mockSocket.timeout.mockReturnValue({ emit })
    expect(emit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Продолжить звонок здесь" }))
    expect(emit).toHaveBeenCalledWith(
        "call:claim",
        { roomId: state.roomId, expectedOwnershipRevision: 2 },
        expect.any(Function)
    )
    expect(active).toMatchObject({ roomId: state.roomId, confirmed: true, ownershipRevision: 3 })
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
})

test("a stale claim refreshes state without silently retrying the transfer", () => {
    render(<IncomingCallHandler />)
    act(() => mockSocket.emit("call:state", passive))
    const emit = jest.fn((event, request, reply) => {
        if (event === "call:claim") reply(null, { err: "Звонок уже перенесён" })
        else request(null, { state: { ...passive, revision: 4, media: { ...passive.media, ownershipRevision: 3 } } })
    })
    mockSocket.timeout.mockReturnValue({ emit })
    fireEvent.click(screen.getByRole("button", { name: "Продолжить звонок здесь" }))
    expect(emit.mock.calls.filter(([event]) => event === "call:claim")).toHaveLength(1)
    expect(active).toBeNull()
    expect(screen.getByRole("alert")).toHaveTextContent("Звонок уже перенесён")
})

test("an unbound modern receiver can still answer a ringing call", () => {
    render(<IncomingCallHandler />)
    act(() =>
        mockSocket.emit("call:state", { ...state, media: { active: false, canClaim: false, ownershipRevision: 0 } })
    )
    expect(screen.getByRole("dialog")).toHaveTextContent("Alice")
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
})

test("late confirmation cannot reactivate an endpoint after ownership was lost", () => {
    render(<IncomingCallHandler />)
    act(() => mockSocket.emit("call:state", { ...passive, media: { ...passive.media, active: true } }))
    expect(active.ownershipRevision).toBe(2)
    mockSocket.timeout.mockReturnValue({ emit: jest.fn() })
    act(() => {
        mockSocket.emit("call:ownershipLost", { roomId: state.roomId, ownershipRevision: 3 })
        mockSocket.emit("call:confirmed", { roomId: state.roomId, ownershipRevision: 2 })
        mockSocket.emit("call:confirmed", { roomId: state.roomId })
    })
    expect(active).toBeNull()
    act(() =>
        mockSocket.emit("call:state", {
            ...passive,
            revision: 4,
            media: { ...passive.media, active: true, ownershipRevision: 4 }
        })
    )
    act(() => mockSocket.emit("call:ownershipLost", { roomId: state.roomId, ownershipRevision: 3 }))
    expect(active.ownershipRevision).toBe(4)
})

test("a confirmation before the modern active snapshot cannot synthesize an owner", () => {
    render(<IncomingCallHandler />)
    act(() =>
        mockSocket.emit("call:state", { ...state, media: { active: false, canClaim: false, ownershipRevision: 0 } })
    )
    mockSocket.timeout.mockReturnValue({ emit: jest.fn() })
    act(() => mockSocket.emit("call:confirmed", { roomId: state.roomId, ownershipRevision: 1 }))
    expect(active).toBeNull()
})
