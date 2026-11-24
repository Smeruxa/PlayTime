import { rowToDisplay } from "./rowDisplay"

test("a former owner of my nickname remains a different author in room history", () => {
    const row = {
        id: 1,
        sender_id: 10,
        sender_username: "moon",
        sender_archived: true,
        content: "old room message",
        created_at: "2026-11-10T20:00:00Z"
    }
    const message = rowToDisplay(row, true, "moon", null, 20)
    expect(message.me).toBe(false)
    expect(message.from).toBe("moon · Гость вышел")
    expect(message.text).toBe("old room message")
    expect(rowToDisplay({ ...row, sender_id: 20, sender_archived: false }, true, "moon", null, 20).me).toBe(true)
})
