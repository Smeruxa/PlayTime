import { getChatDate } from "./formatChatDate"

describe("getChatDate", () => {
    it("changes the local calendar day at midnight", () => {
        expect(getChatDate(new Date(2026, 9, 12, 23, 59, 59, 999).getTime())).toEqual({
            key: "2026-10-12",
            label: "12.10.26"
        })
        expect(getChatDate(new Date(2026, 9, 13, 0, 0, 0, 0).getTime())).toEqual({
            key: "2026-10-13",
            label: "13.10.26"
        })
    })

    it("keeps different hours of the same local day in one group", () => {
        const morning = getChatDate(new Date(2026, 9, 13, 0, 1).getTime())
        const evening = getChatDate(new Date(2026, 9, 13, 23, 59).getTime())
        expect(morning).toEqual({ key: "2026-10-13", label: "13.10.26" })
        expect(evening).toEqual(morning)
    })

    it("distinguishes month and year boundaries", () => {
        expect(getChatDate(new Date(2026, 9, 31, 23, 59).getTime())).toEqual({
            key: "2026-10-31",
            label: "31.10.26"
        })
        expect(getChatDate(new Date(2026, 10, 1, 0, 0).getTime())).toEqual({
            key: "2026-11-01",
            label: "01.11.26"
        })
        expect(getChatDate(new Date(2026, 11, 31, 23, 59).getTime())).toEqual({
            key: "2026-12-31",
            label: "31.12.26"
        })
        expect(getChatDate(new Date(2027, 0, 1, 0, 0).getTime())).toEqual({
            key: "2027-01-01",
            label: "01.01.27"
        })
    })

    it("uses the full year in the key even when short labels coincide", () => {
        const previousCentury = getChatDate(new Date(1926, 9, 13, 12).getTime())
        const currentCentury = getChatDate(new Date(2026, 9, 13, 12).getTime())
        expect(previousCentury).toEqual({ key: "1926-10-13", label: "13.10.26" })
        expect(currentCentury).toEqual({ key: "2026-10-13", label: "13.10.26" })
    })

    it("accepts the zero epoch and formats it in the current timezone", () => {
        expect(getChatDate(0)).toEqual(
            new Date(0).getFullYear() === 1970
                ? { key: "1970-01-01", label: "01.01.70" }
                : { key: "1969-12-31", label: "31.12.69" }
        )
    })

    it.each([NaN, Infinity, -Infinity, 8_640_000_000_000_001, -8_640_000_000_000_001, Number.MAX_VALUE])(
        "returns null for an invalid timestamp: %s",
        (timestamp) => {
            expect(getChatDate(timestamp)).toBeNull()
        }
    )
})
