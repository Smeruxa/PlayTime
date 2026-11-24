import { getChatDate } from "./formatChatDate"
import type { DisplayMessage } from "./types"

const GROUP_INTERVAL_MS = 5 * 60 * 1000

export function areMessagesGrouped(
    current: DisplayMessage,
    other: DisplayMessage | undefined,
    isRoom: boolean
): boolean {
    if (!other || current.isThreadOp || other.isThreadOp || current.me !== other.me) return false
    const currentDate = getChatDate(current.data)
    const otherDate = getChatDate(other.data)
    if (!currentDate || !otherDate || currentDate.key !== otherDate.key) return false
    if (Math.abs(current.data - other.data) > GROUP_INTERVAL_MS) return false
    if (isRoom && !current.me && (!current.from?.trim() || current.from !== other.from)) return false
    return true
}
