export function isOptionalCallRevision(value: unknown): value is number | undefined {
    return value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
}
