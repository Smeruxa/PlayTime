import { EventEmitter } from "events"
import { randomUUID } from "crypto"
import { waitFor } from "@testing-library/react"
import type { Socket } from "socket.io-client"
import { getMessageOutbox, MessageOutbox, mergeOutgoingMessages } from "./messageOutbox"

type Reply = { success?: true; id?: number; err?: string }
type Request = {
    payload: Record<string, unknown>
    resolve: (reply: Reply) => void
    reject: (error: Error) => void
}

function fixture() {
    const requests: Request[] = []
    const emitter = new EventEmitter()
    const socket = Object.assign(emitter, {
        connected: true,
        timeout: jest.fn(() => ({
            emitWithAck: jest.fn(
                (_event: string, payload: Record<string, unknown>) =>
                    new Promise<Reply>((resolve, reject) => requests.push({ payload, resolve, reject }))
            )
        }))
    })
    return { socket: socket as unknown as Socket, emitter, requests, connection: socket }
}

const display = (text: string) => ({ text, data: 100, read: false })

beforeAll(() => Object.defineProperty(crypto, "randomUUID", { configurable: true, value: randomUUID }))

test("accepts several messages immediately and preserves wire order even when the first ACK is lost", async () => {
    const { socket, requests } = fixture()
    const outbox = new MessageOutbox(socket)
    const first = outbox.enqueue("dm:2", display("first"), async () => ({ username: "peer", message: "cipher-first" }))
    outbox.enqueue("dm:2", display("second"), async () => ({ username: "peer", message: "cipher-second" }))
    outbox.enqueue("dm:2", display("third"), async () => ({ username: "peer", message: "cipher-third" }))
    expect(outbox.getSnapshot().map((message) => message.status)).toEqual(["sending", "sending", "sending"])
    expect(mergeOutgoingMessages([], outbox.getSnapshot(), "dm:2").map((message) => message.text)).toEqual([
        "first",
        "second",
        "third"
    ])
    await waitFor(() => expect(requests).toHaveLength(1))

    expect(outbox.confirm("dm:2", "cipher-first", 10)).toBe(first)
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1].payload.message).toBe("cipher-second")
    requests[1].resolve({ success: true, id: 11 })
    await waitFor(() => expect(requests).toHaveLength(3))
    expect(requests[2].payload.message).toBe("cipher-third")
    requests[2].resolve({ success: true, id: 12 })
    requests[0].resolve({ success: true, id: 10 })
    await waitFor(() => expect(outbox.getSnapshot().every((message) => message.status === "sent")).toBe(true))
})

test("a failed message retries the same encrypted payload and UUID without duplicating its bubble", async () => {
    const { socket, requests } = fixture()
    const outbox = new MessageOutbox(socket)
    const prepare = jest.fn(async () => ({ username: "peer", message: "one-randomized-ciphertext" }))
    const clientId = outbox.enqueue("dm:2", display("private text"), prepare)
    await waitFor(() => expect(requests).toHaveLength(1))
    requests[0].resolve({ err: "Transaction rolled back" })
    await waitFor(() => expect(outbox.getSnapshot()[0].status).toBe("failed"))

    outbox.retry(clientId)
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1].payload).toEqual(requests[0].payload)
    expect(prepare).toHaveBeenCalledTimes(1)
    requests[1].resolve({ success: true, id: 30 })
    await waitFor(() => expect(outbox.getSnapshot()[0].status).toBe("sent"))
    const merged = mergeOutgoingMessages(
        [{ id: 30, me: true, text: "private text", data: 100, read: true }],
        outbox.getSnapshot(),
        "dm:2"
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ id: 30, clientMessageId: clientId, read: true })
    outbox.retireStored(new Set([30]))
    expect(outbox.getSnapshot()).toHaveLength(0)
})

test("a read receipt received before the sender ACK still produces the read state", async () => {
    const { socket, requests } = fixture()
    const outbox = new MessageOutbox(socket)
    outbox.enqueue("dm:2", display("hello"), async () => ({ username: "peer", message: "cipher" }))
    await waitFor(() => expect(requests).toHaveLength(1))
    outbox.markRead("dm:2", [40])
    requests[0].resolve({ success: true, id: 40 })
    await waitFor(() => expect(outbox.getSnapshot()[0].display.read).toBe(true))
})

test("a delete arriving before the ACK cannot resurrect a confirmed message", async () => {
    const { socket, requests, emitter } = fixture()
    const outbox = new MessageOutbox(socket)
    outbox.enqueue("dm:2", display("removed"), async () => ({ username: "peer", message: "cipher" }))
    await waitFor(() => expect(requests).toHaveLength(1))
    emitter.emit("message:deleted", { id: 50 })
    requests[0].resolve({ success: true, id: 50 })
    await waitFor(() => expect(outbox.getSnapshot()).toHaveLength(0))
})

test("offline messages retry on reconnect and remain scoped to their conversation", async () => {
    const { socket, requests, connection, emitter } = fixture()
    connection.connected = false
    const outbox = new MessageOutbox(socket)
    outbox.enqueue("dm:2", display("offline"), async () => ({ username: "peer", message: "cipher" }))
    await waitFor(() => expect(outbox.getSnapshot()[0].status).toBe("failed"))
    expect(requests).toHaveLength(0)
    expect(mergeOutgoingMessages([], outbox.getSnapshot(), "dm:3")).toEqual([])
    connection.connected = true
    emitter.emit("connect")
    await waitFor(() => expect(requests).toHaveLength(1))
    requests[0].resolve({ success: true, id: 60 })
    await waitFor(() => expect(outbox.getSnapshot()[0].status).toBe("sent"))
})

test("switching accounts cancels preparation and erases the previous account's plaintext", async () => {
    const { socket, requests } = fixture()
    const previous = getMessageOutbox(socket, 1)
    let finishPreparation: (payload: { username: string; message: string }) => void = () => {}
    previous.enqueue(
        "dm:2",
        display("account-one private text"),
        () =>
            new Promise((resolve) => {
                finishPreparation = resolve
            })
    )
    const next = getMessageOutbox(socket, 2)
    finishPreparation({ username: "peer", message: "account-one-ciphertext" })
    await Promise.resolve()
    expect(previous.getSnapshot()).toEqual([])
    expect(next.getSnapshot()).toEqual([])
    expect(requests).toHaveLength(0)
})

test("the memoized queue remains usable after a server disconnect and same-socket reconnect", async () => {
    const { socket, connection, emitter, requests } = fixture()
    const outbox = getMessageOutbox(socket, 1)
    const firstId = outbox.enqueue("dm:2", display("first"), async () => ({
        username: "peer",
        message: "first-cipher"
    }))
    await waitFor(() => expect(requests).toHaveLength(1))
    connection.connected = false
    emitter.emit("disconnect", "io server disconnect")
    requests[0].reject(new Error("socket disconnected"))
    await waitFor(() => expect(outbox.getSnapshot()[0].status).toBe("failed"))
    connection.connected = true
    emitter.emit("connect")
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(getMessageOutbox(socket, 1)).toBe(outbox)
    expect(requests[1].payload.clientMessageId).toBe(firstId)
    requests[1].resolve({ success: true, id: 70 })
    await waitFor(() => expect(outbox.getSnapshot()[0].status).toBe("sent"))
    outbox.enqueue("dm:2", display("second"), async () => ({ username: "peer", message: "second-cipher" }))
    await waitFor(() => expect(requests).toHaveLength(3))
    requests[2].resolve({ success: true, id: 71 })
    await waitFor(() => expect(outbox.getSnapshot()[1].status).toBe("sent"))
})
