import { act, renderHook } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { SocketProvider } from "./SocketProvider"
import { useSocket } from "./useSocket"
import { useSocketConnection } from "../socket/useSocketConnection"
import { refreshSession, revokeSession } from "../../utils/api"
import { AuthRequestError } from "../../utils/api/refreshSession"
import type { CallProps } from "../../types"

jest.mock("../socket/useSocketConnection")
jest.mock("../../utils/api", () => ({ refreshSession: jest.fn(), revokeSession: jest.fn(async () => {}) }))
jest.mock("../socket/useSocketMyName", () => ({ useSocketMyName: () => ({ myName: "me", myUserId: null }) }))
jest.mock("../socket/useLastPreviewsBootstrap", () => ({ useLastPreviewsBootstrap: jest.fn() }))
jest.mock("../socket/usePresencePolling", () => ({ usePresencePolling: jest.fn() }))
jest.mock("../socket/useMessagePreviewSideEffects", () => ({ useMessagePreviewSideEffects: jest.fn() }))
jest.mock("../../features/chat/hooks/useEnsureDmKeys", () => ({ useEnsureDmKeys: jest.fn() }))

afterEach(() => localStorage.clear())

it.each([false, true])("retains an active call across a transport interruption (party: %s)", (isParty) => {
    const handlers = new Map<string, (...args: any[]) => void>()
    const socket = {
        on: jest.fn((name, fn) => {
            handlers.set(name, fn)
        }),
        off: jest.fn(),
        connected: true
    }
    ;(useSocketConnection as jest.Mock).mockReturnValue(socket)
    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <MemoryRouter>
            <SocketProvider>{children}</SocketProvider>
        </MemoryRouter>
    )
    const { result, rerender } = renderHook(() => useSocket(), { wrapper })
    const call: CallProps = {
        names: ["friend"],
        roomId: isParty ? 7 : "1:2",
        incoming: false,
        confirmed: true,
        isParty
    }
    act(() => result.current.setActiveCall(call))
    act(() => handlers.get("disconnect")!("transport close"))
    expect(result.current.activeCall).toBe(call)
    act(() => handlers.get("disconnect")!("ping timeout"))
    expect(result.current.activeCall).toBe(call)
    ;(useSocketConnection as jest.Mock).mockReturnValue(null)
    rerender()
    expect(result.current.activeCall).toBeNull()
})

it("clears an active call when the server explicitly disconnects the session", () => {
    let disconnect!: (reason: string) => void
    ;(useSocketConnection as jest.Mock).mockReturnValue({
        connected: true,
        on: (name: string, fn: (reason: string) => void) => {
            if (name === "disconnect") disconnect = fn
        },
        off: jest.fn()
    })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <MemoryRouter>
            <SocketProvider>{children}</SocketProvider>
        </MemoryRouter>
    )
    const { result } = renderHook(() => useSocket(), { wrapper })
    act(() => result.current.setActiveCall({ names: ["friend"], roomId: "1:2", incoming: false }))
    act(() => disconnect("io server disconnect"))
    expect(result.current.activeCall).toBeNull()
})

it("keeps logout final when an in-flight refresh returns new credentials", async () => {
    const handlers = new Map<string, (...args: any[]) => void>()
    ;(useSocketConnection as jest.Mock).mockReturnValue({
        connected: true,
        on: (name: string, handler: (...args: any[]) => void) => handlers.set(name, handler),
        off: jest.fn()
    })
    let completeRefresh!: (value: Awaited<ReturnType<typeof refreshSession>>) => void
    ;(refreshSession as jest.Mock).mockReturnValueOnce(
        new Promise((resolve) => {
            completeRefresh = resolve
        })
    )
    ;(revokeSession as jest.Mock).mockClear()
    localStorage.setItem("token", "previous-access")
    localStorage.setItem("refreshToken", "previous-refresh")
    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <MemoryRouter>
            <SocketProvider>{children}</SocketProvider>
        </MemoryRouter>
    )
    const { result } = renderHook(() => useSocket(), { wrapper })
    act(() => result.current.setToken("previous-access"))
    act(() => handlers.get("session:expired")!())
    expect(refreshSession).toHaveBeenCalledWith("previous-refresh")
    act(() => result.current.logout())
    expect(revokeSession).toHaveBeenCalledWith("previous-access", "previous-refresh")
    await act(async () => {
        completeRefresh({
            token: "late-access",
            refreshToken: "late-refresh",
            expiresIn: 900,
            user: { id: 1, username: "me", email: "me@example.test" }
        })
    })
    expect(localStorage.getItem("token")).toBeNull()
    expect(localStorage.getItem("refreshToken")).toBeNull()
    expect(result.current.token).toBeNull()
    expect(revokeSession).toHaveBeenCalledWith("late-access", "late-refresh")
})

it("preserves a new login when a previous account's refresh is rejected", async () => {
    const handlers = new Map<string, (...args: any[]) => void>()
    ;(useSocketConnection as jest.Mock).mockReturnValue({
        connected: true,
        on: (name: string, handler: (...args: any[]) => void) => handlers.set(name, handler),
        off: jest.fn()
    })
    let rejectRefresh!: (error: Error) => void
    ;(refreshSession as jest.Mock).mockReturnValueOnce(
        new Promise((_resolve, reject) => {
            rejectRefresh = reject
        })
    )
    localStorage.setItem("token", "previous-access")
    localStorage.setItem("refreshToken", "previous-refresh")
    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <MemoryRouter>
            <SocketProvider>{children}</SocketProvider>
        </MemoryRouter>
    )
    const { result } = renderHook(() => useSocket(), { wrapper })
    act(() => result.current.setToken("previous-access"))
    act(() => handlers.get("session:expired")!())
    act(() => result.current.logout())
    localStorage.setItem("token", "new-account-access")
    localStorage.setItem("refreshToken", "new-account-refresh")
    act(() => result.current.setToken("new-account-access"))
    await act(async () => {
        rejectRefresh(new AuthRequestError("Previous session revoked", 401))
    })
    expect(localStorage.getItem("token")).toBe("new-account-access")
    expect(localStorage.getItem("refreshToken")).toBe("new-account-refresh")
    expect(result.current.token).toBe("new-account-access")
})

it.each([false, true])(
    "accepts an already persisted shared refresh only before logout (logged out: %s)",
    async (loggedOut) => {
        const handlers = new Map<string, (...args: any[]) => void>()
        ;(useSocketConnection as jest.Mock).mockReturnValue({
            connected: true,
            on: (name: string, handler: (...args: any[]) => void) => handlers.set(name, handler),
            off: jest.fn()
        })
        let completeRefresh!: (value: Awaited<ReturnType<typeof refreshSession>>) => void
        ;(refreshSession as jest.Mock).mockReturnValueOnce(
            new Promise((resolve) => {
                completeRefresh = resolve
            })
        )
        ;(revokeSession as jest.Mock).mockClear()
        localStorage.setItem("token", "previous-access")
        localStorage.setItem("refreshToken", "previous-refresh")
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <MemoryRouter>
                <SocketProvider>{children}</SocketProvider>
            </MemoryRouter>
        )
        const { result } = renderHook(() => useSocket(), { wrapper })
        act(() => result.current.setToken("previous-access"))
        act(() => handlers.get("session:expired")!())
        if (loggedOut) act(() => result.current.logout())
        localStorage.setItem("token", "shared-access")
        localStorage.setItem("refreshToken", "shared-refresh")
        await act(async () => {
            completeRefresh({
                token: "shared-access",
                refreshToken: "shared-refresh",
                expiresIn: 900,
                user: { id: 1, username: "me", email: "me@example.test" }
            })
        })
        expect(result.current.token).toBe(loggedOut ? null : "shared-access")
        expect(localStorage.getItem("refreshToken")).toBe("shared-refresh")
        if (loggedOut) expect(revokeSession).toHaveBeenCalledWith("shared-access", "shared-refresh")
        else expect(revokeSession).not.toHaveBeenCalled()
    }
)

const browserToken = (id: number, sid: string, revision = 0) =>
    `header.${btoa(JSON.stringify({ id, username: `user${id}`, sid, exp: Math.floor(Date.now() / 1000) + 900, revision }))}.signature`
const browserWrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter>
        <SocketProvider>{children}</SocketProvider>
    </MemoryRouter>
)
function storedSession(token: string | null, refresh = "stored-refresh") {
    if (token) {
        localStorage.setItem("token", token)
        localStorage.setItem("refreshToken", refresh)
    } else {
        localStorage.removeItem("token")
        localStorage.removeItem("refreshToken")
    }
    window.dispatchEvent(new StorageEvent("storage", { key: "token", storageArea: localStorage }))
}
function browserSocket() {
    const handlers = new Map<string, (...args: any[]) => void>()
    return {
        handlers,
        connected: true,
        on: jest.fn((event, handler) => {
            handlers.set(event, handler)
        }),
        off: jest.fn(),
        emit: jest.fn()
    }
}

it("adopts another tab's rotated token without interrupting the active call or conversation", () => {
    const socket = browserSocket()
    ;(useSocketConnection as jest.Mock).mockImplementation((token) => (token ? socket : null))
    const { result } = renderHook(() => useSocket(), { wrapper: browserWrapper })
    const original = browserToken(1, "device-a")
    const rotated = browserToken(1, "device-a", 1)
    act(() => storedSession(original))
    const call: CallProps = { names: ["friend"], roomId: "1:2", incoming: false }
    const chat = { name: "friend", id: 2, isRoom: false }
    act(() => {
        result.current.setActiveCall(call)
        result.current.setCurrentChat(chat)
    })
    act(() => storedSession(rotated, "rotated-refresh"))
    expect(result.current.token).toBe(rotated)
    expect(result.current.activeCall).toEqual(call)
    expect(result.current.currentChat).toEqual(chat)
})

it("another tab's logout immediately closes the local session and removes private conversation state", () => {
    const socket = browserSocket()
    ;(useSocketConnection as jest.Mock).mockImplementation((token) => (token ? socket : null))
    const { result } = renderHook(() => useSocket(), { wrapper: browserWrapper })
    act(() => storedSession(browserToken(1, "device-a")))
    act(() => {
        result.current.setActiveCall({ names: ["friend"], roomId: "1:2", incoming: false })
        result.current.setCurrentChat({ name: "friend", id: 2, isRoom: false })
    })
    act(() => storedSession(null))
    expect(result.current.token).toBeNull()
    expect(result.current.activeCall).toBeNull()
    expect(result.current.currentChat).toBeNull()
    expect(result.current.lastPreviews).toEqual({})
})

it.each([false, true])(
    "a newer login clears previous state and ignores the old socket's delayed revocation (same user: %s)",
    (sameUser) => {
        const first = browserSocket(),
            second = browserSocket()
        const previous = browserToken(1, "device-a")
        const replacement = browserToken(sameUser ? 1 : 2, "device-b")
        ;(useSocketConnection as jest.Mock).mockImplementation((token) =>
            token === previous ? first : token ? second : null
        )
        const { result } = renderHook(() => useSocket(), { wrapper: browserWrapper })
        act(() => storedSession(previous))
        const lateRevocation = first.handlers.get("session:revoked")!
        act(() => {
            result.current.setActiveCall({ names: ["friend"], roomId: "1:2", incoming: false })
            result.current.setCurrentChat({ name: "friend", id: 2, isRoom: false })
        })
        act(() => storedSession(replacement, "replacement-refresh"))
        act(() => lateRevocation())
        expect(result.current.token).toBe(replacement)
        expect(localStorage.getItem("token")).toBe(replacement)
        expect(localStorage.getItem("refreshToken")).toBe("replacement-refresh")
        expect(result.current.activeCall).toBeNull()
        expect(result.current.currentChat).toBeNull()
    }
)

it("a delayed refresh result cannot revoke or overwrite a later rotation of the same device", async () => {
    const socket = browserSocket()
    ;(useSocketConnection as jest.Mock).mockImplementation((token) => (token ? socket : null))
    ;(revokeSession as jest.Mock).mockClear()
    let complete!: (value: Awaited<ReturnType<typeof refreshSession>>) => void
    ;(refreshSession as jest.Mock).mockReturnValueOnce(
        new Promise((resolve) => {
            complete = resolve
        })
    )
    const { result } = renderHook(() => useSocket(), { wrapper: browserWrapper })
    act(() => storedSession(browserToken(1, "device-a"), "initial-refresh"))
    act(() => socket.handlers.get("session:expired")!())
    const latest = browserToken(1, "device-a", 2)
    act(() => storedSession(latest, "latest-refresh"))
    await act(async () => {
        complete({ token: browserToken(1, "device-a", 1), refreshToken: "intermediate-refresh", expiresIn: 900 })
    })
    expect(result.current.token).toBe(latest)
    expect(localStorage.getItem("refreshToken")).toBe("latest-refresh")
    expect(revokeSession).not.toHaveBeenCalled()
})
