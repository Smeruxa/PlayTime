import type { Socket } from "socket.io-client"
import type { DisplayMessage } from "../../types"
import { createChatSocketHandlers } from "./createSocketHandlers"
import { MessageHistoryTracker } from "./messageHistoryTracker"

const message = (id: number, text = `message-${id}`): DisplayMessage => ({ id, text, me: true, data: id })
const row = (id: number, content = `message-${id}`) => ({
    id,
    content,
    me: true,
    created_at: new Date(id).toISOString()
})

function fixture(initial: DisplayMessage[] = [], isRoom = false) {
    let messages = initial
    const history = new MessageHistoryTracker()
    const reconciled = jest.fn()
    const deleted = jest.fn()
    const handlers = createChatSocketHandlers({
        socket: { emit: jest.fn() } as unknown as Socket,
        g: 1,
        history,
        loadGenRef: { current: 1 },
        is_room: isRoom,
        id: 2,
        name: "peer",
        myName: "self",
        myUserId: null,
        setChatMessages: (update) => {
            messages = typeof update === "function" ? update(messages) : update
        },
        setHistoryLoading: jest.fn(),
        setRoomMembersEpoch: jest.fn(),
        peerPubRef: { current: null },
        setPeerTyping: jest.fn(),
        setRoomChatMeta: jest.fn(),
        onHistoryReconciled: reconciled,
        onDeletedMessage: deleted,
        onStoredMessage: (_ciphertext, id) => (id === 4 ? "queued-4" : undefined),
        getOutgoingTimestamp: (id) => (id === "queued-4" ? 4 : undefined)
    })
    return { history, handlers, reconciled, deleted, messages: () => messages }
}

it("removes offline-deleted and retention-expired rows from a fresh authoritative snapshot", () => {
    const f = fixture([message(1, "deleted while offline"), message(2), message(3, "expired")])
    f.history.beginLatest("reconnect", [1, 2, 3], [3])
    f.handlers.handleGetMessages({ requestId: "reconnect", messages: [row(2)] })
    expect(f.messages().map((item) => item.id)).toEqual([2])
    expect(f.reconciled).toHaveBeenCalledWith(new Set([3]))
})

it("replays live receive/read/edit/reaction/delete over a stale in-flight snapshot", () => {
    const f = fixture([{ ...message(1), clientMessageId: "local-1" }, message(3)])
    f.history.beginLatest("refresh", [1, 3], [])
    f.handlers.handlePeerRead({ readerUsername: "peer", messageIds: [1] })
    f.handlers.handleMessageEdited({
        id: 1,
        sender_username: "self",
        receiver_username: "peer",
        content: "edited live",
        edited_at: new Date(100).toISOString()
    })
    f.handlers.handleMessageReaction({
        messageId: 1,
        dmSenderUsername: "self",
        dmReceiverUsername: "peer",
        username: "peer",
        emoji: "👍",
        active: true
    })
    f.handlers.handleReceiveMessage({
        id: 2,
        sender_username: "peer",
        receiver_username: "self",
        content: "new live",
        created_at: new Date(2).toISOString()
    })
    f.handlers.handleDeleted({ id: 3 })
    f.handlers.handleGetMessages({
        requestId: "refresh",
        messages: [row(1, "stale original"), row(3, "deleted during query")]
    })
    expect(f.messages().map((item) => item.id)).toEqual([1, 2])
    expect(f.messages()[0]).toMatchObject({
        text: "edited live",
        read: true,
        editedAt: 100,
        clientMessageId: "local-1",
        reactions: [{ emoji: "👍", users: ["peer"] }]
    })
    expect(f.messages()[1].text).toBe("new live")
    expect(f.deleted).toHaveBeenCalledWith(3)
})

it("preserves events whose row was absent until history arrived", () => {
    const f = fixture()
    f.history.beginLatest("initial", [], [])
    f.handlers.handlePeerRead({ readerUsername: "peer", messageIds: [1] })
    f.handlers.handleMessageEdited({
        id: 1,
        sender_username: "self",
        receiver_username: "peer",
        content: "new edit",
        edited_at: new Date(10).toISOString()
    })
    f.handlers.handleMessageReaction({
        messageId: 1,
        dmSenderUsername: "self",
        dmReceiverUsername: "peer",
        username: "peer",
        emoji: "✅",
        active: true
    })
    f.handlers.handleGetMessages({ requestId: "initial", messages: [row(1, "old")] })
    expect(f.messages()[0]).toMatchObject({
        text: "new edit",
        read: true,
        editedAt: 10,
        reactions: [{ emoji: "✅", users: ["peer"] }]
    })
})

it("keeps older-page union but ignores an older response invalidated by a fresh latest request", () => {
    const f = fixture([message(20)])
    f.history.beginOlder("page")
    f.handlers.handleGetMessages({ requestId: "page", beforeId: 20, messages: [row(10)] })
    expect(f.messages().map((item) => item.id)).toEqual([10, 20])
    f.history.beginOlder("stale-page")
    f.history.beginLatest("new-latest", [10, 20], [])
    f.handlers.handleGetMessages({ requestId: "stale-page", beforeId: 10, messages: [row(5)] })
    f.handlers.handleGetMessages({ requestId: "new-latest", messages: [row(20)] })
    expect(f.messages().map((item) => item.id)).toEqual([20])
})

it("ignores late previous latest responses and only retires confirmations captured before GET", () => {
    const f = fixture([message(1)])
    f.history.beginLatest("old", [1], [7])
    const confirmed = new Set([7])
    f.history.beginLatest("current", [1], confirmed)
    confirmed.add(8)
    f.handlers.handleGetMessages({ requestId: "old", messages: [row(9)] })
    expect(f.messages().map((item) => item.id)).toEqual([1])
    expect(f.reconciled).not.toHaveBeenCalled()
    f.handlers.handleGetMessages({ requestId: "current", messages: [] })
    expect(f.messages()).toEqual([])
    expect(f.reconciled).toHaveBeenCalledWith(new Set([7]))
})

it("deduplicates own echo/history without moving the pending bubble to server time", () => {
    const f = fixture()
    f.history.beginLatest("refresh", [], [])
    f.handlers.handleReceiveMessage({
        id: 4,
        sender_username: "self",
        receiver_username: "peer",
        content: "echo",
        created_at: new Date(500).toISOString()
    })
    f.handlers.handleGetMessages({
        requestId: "refresh",
        messages: [{ ...row(4, "echo"), created_at: new Date(600).toISOString() }]
    })
    expect(f.messages()).toHaveLength(1)
    expect(f.messages()[0]).toMatchObject({ id: 4, data: 4, clientMessageId: "queued-4" })
    f.history.beginLatest("again", [4], [])
    f.handlers.handleGetMessages({
        requestId: "again",
        messages: [{ ...row(4), created_at: new Date(900).toISOString() }]
    })
    expect(f.messages()[0].data).toBe(4)
})

it("does not insert a late private DM echo into a room with the same name as its peer", () => {
    const f = fixture([], true)
    f.handlers.handleSendMessage({
        id: 4,
        sender_username: "self",
        receiver_username: "peer",
        content: "private DM",
        created_at: new Date(4).toISOString(),
        read: false,
        me: true
    })
    expect(f.messages()).toEqual([])
})
