import type { DisplayMessage } from "./types"

export function compareDisplayMessages(first: DisplayMessage, second: DisplayMessage): number {
    if (first.data !== second.data) return first.data - second.data
    if (first.id < 0 && second.id < 0) return second.id - first.id
    if (first.id < 0) return 1
    if (second.id < 0) return -1
    return first.id - second.id
}
