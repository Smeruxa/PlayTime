import { matchesDirectMessage, matchesPeer } from "./peerIdentity"

test("a new owner of the same nickname never matches an old conversation", () => {
    const incoming = { sender_id: 20, receiver_id: 1, sender_username: "moon", receiver_username: "alice" }
    expect(matchesDirectMessage(incoming, 10, 1, "moon", "alice")).toBe(false)
    expect(matchesDirectMessage(incoming, 20, 1, "moon", "alice")).toBe(true)
    expect(matchesDirectMessage({ ...incoming, sender_id: 10 }, 10, 1, "old name", "alice")).toBe(true)
})

test("partial or malformed identity cannot fall back to a matching name", () => {
    expect(
        matchesDirectMessage(
            { sender_id: 20, sender_username: "moon", receiver_username: "alice" },
            10,
            1,
            "moon",
            "alice"
        )
    ).toBe(false)
    expect(matchesPeer(20, 10, "moon", "moon")).toBe(false)
    expect(matchesPeer(10, 10, "old name", "moon")).toBe(true)
})
