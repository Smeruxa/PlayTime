import { act, renderHook } from "@testing-library/react"
import { EventEmitter } from "events"
import type { Socket } from "socket.io-client"
import type { DisplayMessage } from "../../types"
import { useChatMessages } from "./useChatMessages"

let mockOutgoing: { chatKey: string; serverId: number }[] = []
const mockEnsureRoomKey = jest.fn()
const mockOutbox = {
    getSnapshot: jest.fn(() => mockOutgoing),
    retireStored: jest.fn(),
    confirm: jest.fn(),
    markRead: jest.fn(),
    isRead: jest.fn(() => false),
    createdAt: jest.fn(),
    forgetDeleted: jest.fn()
}
jest.mock("./ensureRoomSymmetricKey", () => ({
    ensureRoomSymmetricKey: (...args: unknown[]) => mockEnsureRoomKey(...args)
}))
jest.mock("./usePeerDmPublicKeyPoller", () => ({ usePeerDmPublicKeyPoller: () => {} }))
jest.mock("./useOutgoingMessages", () => ({
    useOutgoingMessages: (_socket: unknown, _userId: number, _chatKey: string, stored: DisplayMessage[]) => ({
        outbox: mockOutbox,
        chatMessages: stored
    })
}))

class TestSocket extends EventEmitter {
    connected = true
    requests: { event: string; payload: unknown }[] = []
    emit(event: string, ...args: unknown[]) {
        this.requests.push({ event, payload: args[0] })
        return true
    }
    receive(event: string, payload?: unknown) {
        super.emit(event, payload)
    }
    latestRequest() {
        return this.requests.filter((item) => item.event === "message:getMessages").at(-1)!.payload as {
            requestId: string
        }
    }
}
const row = (id: number) => ({ id, content: `private-${id}`, me: false, created_at: new Date(id).toISOString() })

beforeEach(() => {
    mockOutgoing = []
    mockEnsureRoomKey.mockReset()
    jest.useFakeTimers()
})
afterEach(() => jest.useRealTimers())

it("uses a fresh reconnect request, ignores late old responses, and snapshots only pre-GET confirmations", () => {
    const socket = new TestSocket()
    const { result } = renderHook(() => useChatMessages(socket as unknown as Socket, "self", 1, "peer", 2, false))
    const first = socket.latestRequest().requestId
    act(() => socket.receive("message:getMessages:success", { requestId: first, messages: [row(1), row(2)] }))
    expect(result.current.chatMessages.map((message) => message.id)).toEqual([1, 2])
    mockOutgoing = [{ chatKey: "dm:2", serverId: 7 }]
    act(() => socket.receive("connect"))
    const current = socket.latestRequest().requestId
    expect(result.current.historyLoading).toBe(false)
    expect(current).not.toBe(first)
    mockOutgoing.push({ chatKey: "dm:2", serverId: 8 })
    act(() => socket.receive("message:getMessages:success", { requestId: current, messages: [row(2)] }))
    expect(result.current.chatMessages.map((message) => message.id)).toEqual([2])
    expect(mockOutbox.retireStored).toHaveBeenLastCalledWith(new Set([7]))
    act(() => socket.receive("message:getMessages:success", { requestId: first, messages: [row(1), row(9)] }))
    expect(result.current.chatMessages.map((message) => message.id)).toEqual([2])
})

it("never renders the previous chat or account's rows during a scope transition", () => {
    const socket = new TestSocket()
    const renders: { peer: string; userId: number; ids: number[] }[] = []
    const { rerender } = renderHook(
        ({ peer, id, userId }) => {
            const result = useChatMessages(socket as unknown as Socket, "self", userId, peer, id, false)
            renders.push({ peer, userId, ids: result.chatMessages.map((message) => message.id) })
            return result
        },
        { initialProps: { peer: "first", id: 2, userId: 1 } }
    )
    act(() =>
        socket.receive("message:getMessages:success", {
            requestId: socket.latestRequest().requestId,
            messages: [row(11)]
        })
    )
    expect(renders.at(-1)!.ids).toEqual([11])
    rerender({ peer: "second", id: 3, userId: 1 })
    expect(renders.filter((render) => render.peer === "second").every((render) => !render.ids.includes(11))).toBe(true)
    act(() =>
        socket.receive("message:getMessages:success", {
            requestId: socket.latestRequest().requestId,
            messages: [row(22)]
        })
    )
    rerender({ peer: "second", id: 3, userId: 4 })
    expect(renders.filter((render) => render.userId === 4).every((render) => render.ids.length === 0)).toBe(true)
})

it("cancels a timed-out history request so a late result cannot overwrite current live state", () => {
    const socket = new TestSocket()
    const { result } = renderHook(() => useChatMessages(socket as unknown as Socket, "self", 1, "peer", 2, false))
    const requestId = socket.latestRequest().requestId
    act(() => jest.advanceTimersByTime(15_001))
    expect(result.current.historyLoading).toBe(false)
    act(() => socket.receive("message:getMessages:success", { requestId, messages: [row(5)] }))
    expect(result.current.chatMessages).toEqual([])
})

it("does not issue a room history request when pending key acquisition finishes after unmount", async () => {
    const socket = new TestSocket()
    let resolveKey!: (key: Uint8Array) => void
    mockEnsureRoomKey.mockReturnValue(
        new Promise<Uint8Array>((resolve) => {
            resolveKey = resolve
        })
    )
    const { unmount } = renderHook(() => useChatMessages(socket as unknown as Socket, "self", 1, "room", 10, true))
    expect(mockEnsureRoomKey).toHaveBeenCalledTimes(1)
    unmount()
    await act(async () => resolveKey(new Uint8Array(32)))
    expect(socket.requests.filter((request) => request.event === "message:getMessages")).toEqual([])
})
