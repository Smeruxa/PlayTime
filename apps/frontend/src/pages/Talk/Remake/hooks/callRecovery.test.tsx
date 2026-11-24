import { act, renderHook } from "@testing-library/react"
import { useCallAudio } from "./useCallAudio"
import { usePartyAudio } from "./usePartyAudio"
import { VoiceMesh } from "../../../../webrtc"

jest.mock("../../../../webrtc", () => ({
    VoiceMesh: jest.fn(),
    waitForWebrtcConfig: jest.fn(async () => []),
    parseDirectCallRoom: () => ({ callerId: 1, receiverId: 2 })
}))

function createSocket() {
    const handlers = new Map<string, Set<(...args: any[]) => void>>()
    const emit = jest.fn()
    const socket = {
        connected: true,
        on: jest.fn((name, fn) => {
            if (!handlers.has(name)) handlers.set(name, new Set())
            handlers.get(name)!.add(fn)
        }),
        off: jest.fn((name, fn) => {
            handlers.get(name)?.delete(fn)
        }),
        emit,
        timeout: jest.fn((_ms) => ({ emit })),
        receive(name: string, ...args: any[]) {
            handlers.get(name)?.forEach((fn) => fn(...args))
        },
        reply(name: string, response: unknown, error: Error | null = null) {
            const request = [...socket.emit.mock.calls].reverse().find(([event]) => event === name)!
            request[request.length - 1](error, response)
        }
    }
    return socket
}

describe("call recovery hooks", () => {
    let socket: ReturnType<typeof createSocket>
    let mesh: {
        start: jest.Mock
        startDirectCall: jest.Mock
        connectPartyPeers: jest.Mock
        reconnect: jest.Mock
        destroy: jest.Mock
        updateDirectOwnership: jest.Mock
    }
    const flush = async () => {
        await act(async () => {
            for (let i = 0; i < 20; i++) await Promise.resolve()
        })
    }

    beforeEach(() => {
        jest.useFakeTimers()
        socket = createSocket()
        mesh = {
            start: jest.fn(async () => {}),
            startDirectCall: jest.fn(async () => {}),
            connectPartyPeers: jest.fn(async () => {}),
            reconnect: jest.fn(),
            destroy: jest.fn(async () => {}),
            updateDirectOwnership: jest.fn()
        }
        ;(VoiceMesh as jest.Mock).mockClear().mockImplementation(() => mesh)
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    function directCall() {
        const onEnd = jest.fn()
        const setState = jest.fn()
        const ref = { current: null as VoiceMesh | null }
        const view = renderHook(() => useCallAudio(socket, "1:2", false, onEnd, setState, jest.fn(), true, 1, ref))
        return { ...view, ref, onEnd, setState }
    }

    it("recovers a direct call after microphone permission is granted on retry", async () => {
        mesh.start.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"))
        const { result, ref, onEnd } = directCall()
        await flush()
        expect(result.current.audioError).toBeTruthy()
        expect(result.current.audioReady).toBe(false)
        expect(ref.current).toBeNull()
        expect(mesh.destroy).toHaveBeenCalledTimes(1)
        act(() => result.current.retryAudio())
        await flush()
        expect(result.current.audioError).toBeNull()
        expect(result.current.audioReady).toBe(true)
        expect(onEnd).not.toHaveBeenCalled()
    })

    it("recovers party audio after a denied microphone without an unhandled rejection", async () => {
        mesh.start.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"))
        const ref = { current: null as VoiceMesh | null }
        const { result } = renderHook(() => usePartyAudio(socket, 42, jest.fn(), 1, ref))
        act(() => socket.receive("party:participants:list", []))
        await flush()
        expect(result.current.audioError).toBeTruthy()
        expect(ref.current).toBeNull()
        act(() => result.current.retryAudio())
        await flush()
        expect(result.current.audioError).toBeNull()
        expect(result.current.audioReady).toBe(true)
        expect(mesh.connectPartyPeers).toHaveBeenCalledTimes(1)
    })

    it("keeps the direct call and media alive until signalling reconnects", async () => {
        const { result, ref, onEnd, setState } = directCall()
        await flush()
        expect(result.current.audioReady).toBe(true)
        socket.connected = false
        act(() => socket.receive("disconnect", "transport close"))
        expect(onEnd).not.toHaveBeenCalled()
        expect(mesh.destroy).not.toHaveBeenCalled()
        expect(ref.current).toBe(mesh)
        expect(setState).toHaveBeenLastCalledWith("Восстанавливаем соединение...")
        socket.connected = true
        act(() => socket.receive("connect"))
        expect(mesh.reconnect).not.toHaveBeenCalled()
        act(() => socket.reply("call:resume", { success: true, status: "in_call" }))
        await flush()
        expect(mesh.reconnect).toHaveBeenCalledTimes(1)
        expect(VoiceMesh).toHaveBeenCalledTimes(1)
        expect(onEnd).not.toHaveBeenCalled()
    })

    it("closes a call that the peer ended while this client was offline", async () => {
        const { onEnd } = directCall()
        await flush()
        act(() => socket.receive("connect"))
        act(() => socket.reply("call:resume", { ended: true }))
        await flush()
        expect(onEnd).toHaveBeenCalledTimes(1)
        expect(mesh.destroy).toHaveBeenCalledTimes(1)
        expect(mesh.reconnect).not.toHaveBeenCalled()
    })

    it("retries timed-out resume requests and cancels retries on unmount", async () => {
        const { unmount, onEnd } = directCall()
        await flush()
        act(() => socket.receive("connect"))
        act(() => socket.reply("call:resume", undefined, new Error("timeout")))
        act(() => jest.advanceTimersByTime(2_000))
        expect(socket.emit.mock.calls.filter(([name]) => name === "call:resume")).toHaveLength(2)
        expect(onEnd).not.toHaveBeenCalled()
        act(() => socket.reply("call:resume", undefined, new Error("timeout")))
        unmount()
        act(() => jest.advanceTimersByTime(20_000))
        expect(socket.emit.mock.calls.filter(([name]) => name === "call:resume")).toHaveLength(2)
    })

    it("ignores confirmations from another room or a previous ownership epoch", async () => {
        const ref = { current: null as VoiceMesh | null }
        let active = { roomId: "1:2", ownershipRevision: 3, confirmed: false }
        const update = jest.fn((fn) => {
            active = fn(active)
        })
        const { result } = renderHook(() =>
            useCallAudio(socket, "1:2", false, jest.fn(), jest.fn(), update, false, 1, ref, undefined, {
                ownershipRevision: 3,
                peerOwnershipRevision: 1
            })
        )
        act(() => {
            socket.receive("call:confirmed", { roomId: "old-call", ownershipRevision: 3 })
            socket.receive("call:confirmed", { roomId: "1:2", ownershipRevision: 2 })
            socket.receive("call:confirmed", { roomId: "1:2" })
        })
        await flush()
        expect(VoiceMesh).not.toHaveBeenCalled()
        expect(update).not.toHaveBeenCalled()
        act(() => socket.receive("call:confirmed", { roomId: "1:2", ownershipRevision: 3 }))
        await flush()
        expect(active.confirmed).toBe(true)
        expect(result.current.audioReady).toBe(true)
    })

    it("does not confirm a replacement call through a delayed state updater", async () => {
        const ref = { current: null as VoiceMesh | null }
        const update = jest.fn()
        renderHook(() => useCallAudio(socket, "1:2", false, jest.fn(), jest.fn(), update, false, 1, ref))
        act(() => socket.receive("call:confirmed", { roomId: "1:2" }))
        const replacement = { roomId: "3:4", confirmed: false }
        expect(update.mock.calls[0][0](replacement)).toBe(replacement)
        await flush()
    })

    it("stops media synchronously on ownership loss before React unmounts the old panel", async () => {
        const ref = { current: null as VoiceMesh | null }
        const onEnd = jest.fn()
        const update = jest.fn()
        const { result } = renderHook(() =>
            useCallAudio(socket, "1:2", false, onEnd, jest.fn(), update, true, 1, ref, undefined, {
                ownershipRevision: 1,
                peerOwnershipRevision: 1
            })
        )
        await flush()
        act(() => {
            socket.receive("call:ownershipLost", { roomId: "1:2", ownershipRevision: 2 })
            socket.receive("call:confirmed", { roomId: "1:2", ownershipRevision: 1 })
        })
        await flush()
        expect(ref.current).toBeNull()
        expect(mesh.destroy).toHaveBeenCalledTimes(1)
        expect(result.current.audioReady).toBe(false)
        expect(VoiceMesh).toHaveBeenCalledTimes(1)
        expect(update).not.toHaveBeenCalled()
        expect(onEnd).not.toHaveBeenCalled()
        expect(socket.emit.mock.calls.filter(([event]) => event === "call:end")).toHaveLength(0)
    })

    it("rejoins a party before restarting its media, keeping the same mesh", async () => {
        const ref = { current: null as VoiceMesh | null }
        const setState = jest.fn()
        const { result } = renderHook(() => usePartyAudio(socket, 7, setState, 1, ref))
        act(() => socket.receive("party:participants:list", [{ userId: 2, username: "friend" }]))
        await flush()
        act(() => socket.reply("room:enter", { success: true }))
        expect(result.current.audioReady).toBe(true)
        mesh.reconnect.mockClear()
        socket.connected = false
        act(() => socket.receive("disconnect"))
        socket.connected = true
        act(() => socket.receive("connect"))
        expect(socket.emit.mock.calls.filter(([name]) => name === "room:enter")).toHaveLength(2)
        expect(mesh.reconnect).not.toHaveBeenCalled()
        act(() => socket.reply("room:enter", { success: true }))
        await flush()
        expect(mesh.reconnect).toHaveBeenCalledTimes(1)
        expect(mesh.destroy).not.toHaveBeenCalled()
        expect(VoiceMesh).toHaveBeenCalledTimes(1)
    })

    it.each(["room:removed", "party:roomClosed"])("closes party media when receiving %s", async (event) => {
        const ref = { current: null as VoiceMesh | null }
        const setState = jest.fn()
        const { result } = renderHook(() => usePartyAudio(socket, 7, setState, 1, ref))
        act(() => socket.receive("party:participants:list", []))
        await flush()
        expect(result.current.audioReady).toBe(true)
        act(() => socket.receive(event, { roomId: 8 }))
        expect(mesh.destroy).not.toHaveBeenCalled()
        act(() => socket.receive(event, { roomId: 7 }))
        await flush()
        expect(mesh.destroy).toHaveBeenCalledTimes(1)
        expect(ref.current).toBeNull()
        expect(result.current.audioReady).toBe(false)
    })
})
