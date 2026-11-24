import { renderHook } from "@testing-library/react"
import { io } from "socket.io-client"
import { useSocketConnection } from "./useSocketConnection"

jest.mock("socket.io-client", () => ({ io: jest.fn() }))
jest.mock("../../config", () => ({ SOCKET_URL: "https://api.example.test", SOCKET_PATH: "/playtime/socket.io" }))

function token(id: number, sid: string, revision = 0) {
    return `header.${btoa(JSON.stringify({ id, username: `user${id}`, sid, revision }))}.signature`
}
function socket() {
    return { connected: true, on: jest.fn(), emit: jest.fn(), disconnect: jest.fn(), connect: jest.fn() }
}
beforeEach(() => jest.clearAllMocks())

test("a rotated token for the same device reauthenticates the existing call socket", () => {
    const connected = socket()
    ;(io as jest.Mock).mockReturnValue(connected)
    const initial = token(1, "device-a")
    const rotated = token(1, "device-a", 1)
    const { result, rerender } = renderHook(({ access }) => useSocketConnection(access), {
        initialProps: { access: initial }
    })
    expect(result.current).toBe(connected)
    rerender({ access: rotated })
    expect(io).toHaveBeenCalledTimes(1)
    expect(connected.disconnect).not.toHaveBeenCalled()
    expect(connected.emit).toHaveBeenLastCalledWith("auth:refresh", { token: rotated, peerIdentityProtocol: 1 })
    const callback = jest.fn()
    ;(io as jest.Mock).mock.calls[0][1].auth(callback)
    ;(io as jest.Mock).mock.calls[0][1].auth(callback)
    expect(callback.mock.calls[0][0].callEndpointId).toBe(callback.mock.calls[1][0].callEndpointId)
    expect(callback).toHaveBeenCalledWith({
        token: rotated,
        callProtocol: 3,
        callEndpointId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
        peerIdentityProtocol: 1
    })
})

test.each([false, true])(
    "a different login uses a fresh socket and never sends new credentials on the previous socket (same user: %s)",
    (sameUser) => {
        const previous = socket(),
            next = socket()
        ;(io as jest.Mock).mockReturnValueOnce(previous).mockReturnValueOnce(next)
        const initial = token(1, "device-a")
        const changed = token(sameUser ? 1 : 2, "device-b")
        const { result, rerender } = renderHook(({ access }) => useSocketConnection(access), {
            initialProps: { access: initial }
        })
        const oldOptions = (io as jest.Mock).mock.calls[0][1]
        previous.emit.mockClear()
        rerender({ access: changed })
        expect(previous.disconnect).toHaveBeenCalledTimes(1)
        expect(previous.emit).not.toHaveBeenCalledWith("auth:refresh", { token: changed, peerIdentityProtocol: 1 })
        expect(io).toHaveBeenCalledTimes(2)
        expect(result.current).toBe(next)
        const callback = jest.fn()
        oldOptions.auth(callback)
        expect(callback).toHaveBeenCalledWith({
            token: "",
            callProtocol: 3,
            callEndpointId: expect.stringMatching(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            ),
            peerIdentityProtocol: 1
        })
    }
)

test("logging out disconnects the socket and exposes no previous connection", () => {
    const connected = socket()
    ;(io as jest.Mock).mockReturnValue(connected)
    const { result, rerender } = renderHook(({ access }: { access: string | null }) => useSocketConnection(access), {
        initialProps: { access: token(1, "device-a") as string | null }
    })
    rerender({ access: null })
    expect(connected.disconnect).toHaveBeenCalledTimes(1)
    expect(result.current).toBeNull()
})
