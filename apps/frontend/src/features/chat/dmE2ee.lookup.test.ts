import { EventEmitter } from "events"
import type { Socket } from "socket.io-client"
import { fetchFriendDmPublicKey } from "./dmE2ee"
import { checkPeerKey } from "./peerKeyTrust"
import { MessageSendError } from "./sendWithReceipt"

jest.mock("./peerKeyTrust", () => ({ checkPeerKey: jest.fn() }))

type Reply = { publicKey?: string | null; err?: string }

function fixture() {
    const emitter = new EventEmitter()
    let acknowledge: (reply: Reply) => void = () => {}
    const emitWithAck = jest.fn(
        () =>
            new Promise<Reply>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("ACK timeout")), 8000)
                acknowledge = (reply) => {
                    clearTimeout(timer)
                    resolve(reply)
                }
            })
    )
    const socket = Object.assign(emitter, {
        connected: true,
        timeout: jest.fn(() => ({ emitWithAck }))
    })
    return {
        socket: socket as unknown as Socket,
        emitter,
        emitWithAck,
        acknowledge: (reply: Reply) => acknowledge(reply)
    }
}

beforeEach(() => {
    jest.useFakeTimers()
    jest.mocked(checkPeerKey).mockReset().mockReturnValue(true)
})

afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
})

test("uses a bounded key ACK and preserves the peer trust check", async () => {
    const { socket, emitter, emitWithAck, acknowledge } = fixture()
    const controller = new AbortController()
    const remove = jest.spyOn(controller.signal, "removeEventListener")
    const pending = fetchFriendDmPublicKey(socket, "peer", controller.signal)
    expect(socket.timeout).toHaveBeenCalledWith(8000)
    expect(emitWithAck).toHaveBeenCalledWith("profile:getDmPublicKey", { username: "peer" })
    acknowledge({ publicKey: "trusted-key" })
    await expect(pending).resolves.toBe("trusted-key")
    expect(checkPeerKey).toHaveBeenCalledWith("peer", "trusted-key", "peer")
    expect(emitter.listenerCount("disconnect")).toBe(0)
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function))
})

test.each([{ publicKey: null }, { err: "unavailable" }])("missing keys resolve null: %j", async (reply) => {
    const { socket, acknowledge } = fixture()
    const pending = fetchFriendDmPublicKey(socket, "peer", new AbortController().signal)
    acknowledge(reply)
    await expect(pending).resolves.toBeNull()
    expect(checkPeerKey).not.toHaveBeenCalled()
})

test("a changed untrusted key remains unavailable", async () => {
    jest.mocked(checkPeerKey).mockReturnValue(false)
    const { socket, acknowledge } = fixture()
    const pending = fetchFriendDmPublicKey(socket, "peer", new AbortController().signal)
    acknowledge({ publicKey: "changed-key" })
    await expect(pending).resolves.toBeNull()
    expect(checkPeerKey).toHaveBeenCalledWith("peer", "changed-key", "peer")
})

test("a lost key ACK rejects as retryable instead of holding the chat queue forever", async () => {
    const { socket, emitter } = fixture()
    const pending = fetchFriendDmPublicKey(socket, "peer", new AbortController().signal)
    const result = expect(pending).rejects.toMatchObject({ name: "Error", retryable: true })
    await jest.advanceTimersByTimeAsync(8000)
    await result
    expect(emitter.listenerCount("disconnect")).toBe(0)
})

test.each(["abort", "disconnect"])(
    "%s settles immediately and ignores a late key without trusting it",
    async (event) => {
        const { socket, emitter, acknowledge } = fixture()
        const controller = new AbortController()
        const remove = jest.spyOn(controller.signal, "removeEventListener")
        const pending = fetchFriendDmPublicKey(socket, "peer", controller.signal)
        const rejected = expect(pending).rejects.toBeInstanceOf(MessageSendError)
        if (event === "abort") controller.abort()
        else emitter.emit("disconnect", "transport close")
        await rejected
        expect(emitter.listenerCount("disconnect")).toBe(0)
        expect(remove).toHaveBeenCalledWith("abort", expect.any(Function))
        acknowledge({ publicKey: "late-untrusted-key" })
        await Promise.resolve()
        expect(checkPeerKey).not.toHaveBeenCalled()
    }
)

test("an already aborted or offline lookup emits no request", async () => {
    const { socket, emitter, emitWithAck } = fixture()
    const controller = new AbortController()
    controller.abort()
    await expect(fetchFriendDmPublicKey(socket, "peer", controller.signal)).rejects.toMatchObject({ retryable: true })
    Object.assign(socket, { connected: false })
    await expect(fetchFriendDmPublicKey(socket, "peer", new AbortController().signal)).rejects.toMatchObject({
        retryable: true
    })
    expect(emitWithAck).not.toHaveBeenCalled()
    expect(emitter.listenerCount("disconnect")).toBe(0)
})

test.each(["timeout", "disconnect"])(
    "legacy callers resolve null on %s without an unhandled rejection",
    async (event) => {
        const { socket, emitter } = fixture()
        const pending = fetchFriendDmPublicKey(socket, "peer")
        const result = expect(pending).resolves.toBeNull()
        if (event === "timeout") await jest.advanceTimersByTimeAsync(8000)
        else emitter.emit("disconnect", "transport close")
        await result
        expect(emitter.listenerCount("disconnect")).toBe(0)
    }
)

test("the same nickname uses independent trust records for distinct peer IDs", async () => {
    const first = fixture()
    const pendingFirst = fetchFriendDmPublicKey(first.socket, "moon", undefined, 10)
    first.acknowledge({ publicKey: "old-key" })
    await expect(pendingFirst).resolves.toBe("old-key")
    expect(first.emitWithAck).toHaveBeenCalledWith("profile:getDmPublicKey", { username: "moon", peerUserId: 10 })
    expect(checkPeerKey).toHaveBeenCalledWith("dm:10", "old-key", "moon")
    const second = fixture()
    const pendingSecond = fetchFriendDmPublicKey(second.socket, "moon", undefined, 20)
    second.acknowledge({ publicKey: "new-key" })
    await expect(pendingSecond).resolves.toBe("new-key")
    expect(checkPeerKey).toHaveBeenCalledWith("dm:20", "new-key", "moon")
})
