import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import type { DisplayMessage } from "../types"
import { ChatMessageList } from "./ChatMessageList"

jest.mock("./ChatEmojiRichText", () => ({
    ChatEmojiRichText: ({ text }: { text: string }) => <>{text}</>
}))
jest.mock("./ChatEmojiImg", () => ({ ChatEmojiImg: () => null }))
jest.mock("./VoiceMessagePlayer", () => ({ VoiceMessagePlayer: () => null }))
jest.mock("./ChatAttachmentBubble", () => ({ ChatAttachmentBubble: () => null }))

const defaultProps = {
    is_room: false,
    myName: "Саша",
    onMessageContextMenu: jest.fn(),
    onToggleReaction: jest.fn()
}
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia")

function message(id: number, day: number, overrides: Partial<DisplayMessage> = {}): DisplayMessage {
    return {
        id,
        me: false,
        text: `Сообщение ${id}`,
        from: "alex",
        data: new Date(2026, 9, day, 12, id).getTime(),
        ...overrides
    }
}

function messageRow(id: number): HTMLElement {
    const bubble = document.querySelector(`[data-msg-id="${id}"]`)
    expect(bubble).not.toBeNull()
    return bubble!.closest(".msgRow") as HTMLElement
}

function domOrder(container: HTMLElement): string[] {
    return Array.from(container.firstElementChild!.children).flatMap((element) => {
        const time = element.querySelector("time[datetime]")
        if (time) return [`date:${time.getAttribute("datetime")}`]
        if (element.getAttribute("aria-label") === "Новые сообщения") return ["unread"]
        const bubble = element.querySelector("[data-msg-id]")
        if (bubble) return [`message:${bubble.getAttribute("data-msg-id")}`]
        if (element.classList.contains("threadOpRow")) return [`thread:${element.textContent}`]
        return []
    })
}

beforeAll(() => {
    Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: jest.fn(() => ({ matches: true }))
    })
})

beforeEach(() => {
    jest.spyOn(window, "requestAnimationFrame").mockReturnValue(0)
})

afterEach(() => {
    cleanup()
    jest.restoreAllMocks()
})

afterAll(() => {
    if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia)
    else Reflect.deleteProperty(window, "matchMedia")
})

it("labels the first day once and puts its divider after the earliest row in the reverse DOM", () => {
    const { container } = render(<ChatMessageList {...defaultProps} messages={[message(1, 12), message(2, 12)]} />)

    const divider = screen.getByRole("separator", { name: "Сообщения за 12.10.26" })
    expect(screen.getAllByRole("separator")).toHaveLength(1)
    expect(within(divider).getByText("12.10.26")).toHaveAttribute("datetime", "2026-10-12")
    expect(messageRow(1).nextElementSibling).toBe(divider)
    expect(domOrder(container)).toEqual(["message:2", "message:1", "date:2026-10-12"])
})

it("keeps chronological date boundaries when an entire day contains only thread operations", () => {
    const { container } = render(
        <ChatMessageList
            {...defaultProps}
            messages={[
                message(1, 12, { data: new Date(2026, 9, 12, 23, 59).getTime() }),
                message(2, 13, {
                    isThreadOp: true,
                    text: "Комната создана",
                    data: new Date(2026, 9, 13, 0, 0).getTime()
                }),
                message(3, 13, { isThreadOp: true, text: "Участник присоединился" }),
                message(4, 14)
            ]}
        />
    )

    expect(screen.getAllByRole("separator").map((element) => element.textContent)).toEqual([
        "14.10.26",
        "13.10.26",
        "12.10.26"
    ])
    expect(domOrder(container)).toEqual([
        "message:4",
        "date:2026-10-14",
        "thread:Участник присоединился",
        "thread:Комната создана",
        "date:2026-10-13",
        "message:1",
        "date:2026-10-12"
    ])
})

it("moves the existing header when prepending the same day and adds one header for an older day", () => {
    const recent = [message(3, 13), message(4, 14)]
    const { container, rerender } = render(<ChatMessageList {...defaultProps} messages={recent} />)

    const olderSameDay = message(2, 13, { data: new Date(2026, 9, 13, 9).getTime() })
    rerender(<ChatMessageList {...defaultProps} messages={[olderSameDay, ...recent]} />)
    expect(screen.getAllByRole("separator")).toHaveLength(2)
    expect(domOrder(container)).toEqual(["message:4", "date:2026-10-14", "message:3", "message:2", "date:2026-10-13"])
    expect(messageRow(2).nextElementSibling).toBe(screen.getByRole("separator", { name: "Сообщения за 13.10.26" }))

    rerender(<ChatMessageList {...defaultProps} messages={[message(1, 12), olderSameDay, ...recent]} />)
    expect(screen.getAllByRole("separator")).toHaveLength(3)
    expect(domOrder(container)).toEqual([
        "message:4",
        "date:2026-10-14",
        "message:3",
        "message:2",
        "date:2026-10-13",
        "message:1",
        "date:2026-10-12"
    ])
})

it("repeats a room author on a new day while grouping consecutive messages within each day", () => {
    render(
        <ChatMessageList
            {...defaultProps}
            is_room
            messages={[message(1, 12), message(2, 12), message(3, 13), message(4, 13)]}
        />
    )

    expect(screen.getAllByText("alex", { exact: true })).toHaveLength(2)
    for (const id of [1, 3]) expect(within(messageRow(id)).getByText("alex", { exact: true })).toBeInTheDocument()
    for (const id of [2, 4]) expect(within(messageRow(id)).queryByText("alex", { exact: true })).not.toBeInTheDocument()
})

it("places the room unread marker above the first unread row and below its day header", () => {
    const { container } = render(
        <ChatMessageList
            {...defaultProps}
            is_room
            roomReadWatermark={2}
            messages={[message(1, 12), message(2, 12), message(3, 13), message(4, 13)]}
        />
    )

    const unread = screen.getByRole("separator", { name: "Новые сообщения" })
    expect(screen.getAllByRole("separator", { name: "Новые сообщения" })).toHaveLength(1)
    expect(screen.getAllByRole("separator", { name: /^Сообщения за / })).toHaveLength(2)
    expect(messageRow(3).nextElementSibling).toBe(unread)
    expect(unread.nextElementSibling).toBe(screen.getByRole("separator", { name: "Сообщения за 13.10.26" }))
    expect(domOrder(container)).toEqual([
        "message:4",
        "message:3",
        "unread",
        "date:2026-10-13",
        "message:2",
        "message:1",
        "date:2026-10-12"
    ])
})

it("keeps sent/read labels and the original edited time without a duplicate read caption", () => {
    const sent = message(1, 12, {
        me: true,
        from: "Саша",
        read: false,
        data: new Date(2026, 9, 12, 13, 24).getTime(),
        editedAt: new Date(2026, 9, 12, 13, 26).getTime()
    })
    const read = message(2, 12, { me: true, from: "Саша", read: true, data: sent.data + 60_000 })
    const { rerender } = render(<ChatMessageList {...defaultProps} messages={[sent, read]} />)

    expect(within(messageRow(1)).getByLabelText("Отправлено")).toHaveAttribute("title", "Отправлено")
    expect(within(messageRow(2)).getByLabelText("Прочитано")).toHaveAttribute("title", "Прочитано")
    expect(screen.queryByText("Прочитано", { exact: true })).not.toBeInTheDocument()
    expect(within(messageRow(1)).getByTitle("Сообщение изменено").parentElement).toHaveTextContent("13:24 · изм.")
    expect(within(messageRow(2)).queryByTitle("Сообщение изменено")).not.toBeInTheDocument()

    rerender(<ChatMessageList {...defaultProps} messages={[{ ...sent, read: true }, read]} />)
    expect(screen.queryByLabelText("Отправлено")).not.toBeInTheDocument()
    expect(screen.getAllByLabelText("Прочитано")).toHaveLength(2)
    expect(screen.queryByText("Прочитано", { exact: true })).not.toBeInTheDocument()
})

it("keeps reactions outside the bubble, toggles the correct emoji and isolates their context menu", () => {
    const onToggleReaction = jest.fn()
    const onMessageContextMenu = jest.fn()
    const onParentContextMenu = jest.fn()
    const reacted = message(7, 12, {
        reactions: [
            { emoji: "👍", users: ["Саша", "alex"] },
            { emoji: "🎧", users: ["alex"] }
        ]
    })
    const { rerender } = render(
        <div onContextMenu={onParentContextMenu}>
            <ChatMessageList
                {...defaultProps}
                messages={[reacted]}
                onToggleReaction={onToggleReaction}
                onMessageContextMenu={onMessageContextMenu}
            />
        </div>
    )
    const bubble = document.querySelector('[data-msg-id="7"]') as HTMLElement
    const liked = within(messageRow(7)).getByTitle("Саша, alex")
    const headphones = within(messageRow(7)).getByTitle("alex")
    expect(bubble).not.toContainElement(liked)
    expect(messageRow(7)).toContainElement(liked)
    expect(liked).toHaveAttribute("aria-pressed", "true")
    expect(liked).toHaveTextContent("2")
    expect(headphones).toHaveAttribute("aria-pressed", "false")
    expect(headphones).toHaveTextContent("1")

    fireEvent.click(liked)
    fireEvent.click(headphones)
    expect(onToggleReaction.mock.calls).toEqual([
        [7, "👍"],
        [7, "🎧"]
    ])
    fireEvent.contextMenu(liked)
    expect(onMessageContextMenu).not.toHaveBeenCalled()
    expect(onParentContextMenu).not.toHaveBeenCalled()

    rerender(
        <div onContextMenu={onParentContextMenu}>
            <ChatMessageList
                {...defaultProps}
                messages={[{ ...reacted, reactions: [{ emoji: "👍", users: ["alex"] }] }]}
                onToggleReaction={onToggleReaction}
                onMessageContextMenu={onMessageContextMenu}
            />
        </div>
    )
    const updated = within(messageRow(7)).getByRole("button")
    expect(updated).toHaveAttribute("aria-pressed", "false")
    expect(updated).toHaveTextContent("1")
})

it("preserves reply and message text and passes the original message to the context callback", () => {
    const onMessageContextMenu = jest.fn()
    const replied = message(9, 12, {
        text: "Вижу, уже иду 👌",
        reply: { id: 3, author: "Ира", preview: "Возьми наушники 🎧" }
    })
    render(<ChatMessageList {...defaultProps} messages={[replied]} onMessageContextMenu={onMessageContextMenu} />)

    const row = messageRow(9)
    expect(within(row).getByText("Ира", { exact: true })).toBeInTheDocument()
    expect(within(row).getByText("Возьми наушники 🎧", { exact: true })).toBeInTheDocument()
    const text = within(row).getByText("Вижу, уже иду 👌", { exact: true })
    fireEvent.contextMenu(text, { clientX: 73, clientY: 29 })

    expect(onMessageContextMenu).toHaveBeenCalledTimes(1)
    expect(onMessageContextMenu).toHaveBeenCalledWith(
        expect.objectContaining({ type: "contextmenu", clientX: 73, clientY: 29 }),
        replied
    )
    expect(onMessageContextMenu.mock.calls[0][1]).toBe(replied)
})
