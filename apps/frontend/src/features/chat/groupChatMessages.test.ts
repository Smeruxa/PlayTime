import { areMessagesGrouped } from "./groupChatMessages"
import type { DisplayMessage } from "./types"

const noon = new Date(2026, 10, 10, 12).getTime()
function message(overrides: Partial<DisplayMessage> = {}): DisplayMessage {
    return { id: 1, me: false, text: "Привет", data: noon, ...overrides }
}

describe("areMessagesGrouped", () => {
    it("groups consecutive DM messages without requiring a from field", () => {
        expect(areMessagesGrouped(message(), message({ id: 2, data: noon + 60_000 }), false)).toBe(true)
        expect(areMessagesGrouped(message({ me: true }), message({ id: 2, me: true }), false)).toBe(true)
        expect(areMessagesGrouped(message({ from: "alex" }), message({ id: 2, from: "mira" }), false)).toBe(true)
    })

    it("starts a new group when the conversation switches between mine and theirs", () => {
        expect(areMessagesGrouped(message(), message({ id: 2, me: true }), false)).toBe(false)
        expect(areMessagesGrouped(message({ me: true }), message({ id: 2 }), true)).toBe(false)
    })

    it("includes exactly five minutes but separates a longer gap, independently of argument order", () => {
        const first = message()
        const lastInGroup = message({ id: 2, data: noon + 300_000 })
        expect(areMessagesGrouped(first, lastInGroup, false)).toBe(true)
        expect(areMessagesGrouped(lastInGroup, first, false)).toBe(true)
        expect(areMessagesGrouped(first, message({ id: 2, data: noon + 300_001 }), false)).toBe(false)
        expect(areMessagesGrouped(message({ data: noon + 300_001 }), first, false)).toBe(false)
    })

    it("groups across an hour boundary without using the clock's minute field", () => {
        expect(
            areMessagesGrouped(
                message({ data: new Date(2026, 10, 10, 12, 58).getTime() }),
                message({ id: 2, data: new Date(2026, 10, 10, 13, 2).getTime() }),
                false
            )
        ).toBe(true)
    })

    it("separates local days even when midnight is only a minute apart", () => {
        expect(
            areMessagesGrouped(
                message({ data: new Date(2026, 10, 10, 23, 59).getTime() }),
                message({ id: 2, data: new Date(2026, 10, 11, 0, 0).getTime() }),
                false
            )
        ).toBe(false)
    })

    it("requires an exact nonempty author for incoming room messages", () => {
        expect(areMessagesGrouped(message({ from: "alex" }), message({ id: 2, from: "alex" }), true)).toBe(true)
        for (const from of [undefined, "", "   ", "mira", " alex"])
            expect(areMessagesGrouped(message({ from: "alex" }), message({ id: 2, from }), true)).toBe(false)
        for (const from of [undefined, "", "   "])
            expect(areMessagesGrouped(message({ from }), message({ id: 2, from }), true)).toBe(false)
    })

    it("does not require room author metadata for the owner's own messages", () => {
        expect(areMessagesGrouped(message({ me: true }), message({ id: 2, me: true }), true)).toBe(true)
    })

    it("never groups thread operations with messages or one another", () => {
        const regular = message()
        const operation = message({ id: -1, isThreadOp: true })
        expect(areMessagesGrouped(regular, operation, false)).toBe(false)
        expect(areMessagesGrouped(operation, regular, false)).toBe(false)
        expect(areMessagesGrouped(operation, message({ id: -2, isThreadOp: true }), false)).toBe(false)
    })

    it("treats voice and attachment messages as real messages even with empty text", () => {
        const voice = message({ text: "", voice: { key: "voice-key", durationSec: 4 } })
        const attachment = message({
            id: 2,
            text: "",
            attachment: { key: "file-key", mime: "image/png", filename: "image.png", sizeBytes: 100 }
        })
        expect(areMessagesGrouped(voice, attachment, false)).toBe(true)
    })

    it("starts a group when no adjacent message exists and accepts the zero epoch", () => {
        expect(areMessagesGrouped(message(), undefined, false)).toBe(false)
        expect(areMessagesGrouped(message({ data: 0 }), message({ id: 2, data: 1000 }), false)).toBe(true)
    })

    it.each([NaN, Infinity, -Infinity, 8_640_000_000_000_001, -8_640_000_000_000_001])(
        "does not group an invalid date in either position: %s",
        (data) => {
            expect(areMessagesGrouped(message({ data }), message(), false)).toBe(false)
            expect(areMessagesGrouped(message(), message({ id: 2, data }), false)).toBe(false)
        }
    )
})
