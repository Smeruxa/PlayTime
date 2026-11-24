import { isPlainRecord } from "../../utils/e2eeWire"
import { parsePositiveInt } from "./helpers"

export function parseRoomE2eeBundlePayload(data: unknown): number | null {
    if (!isPlainRecord(data)) return null
    return parsePositiveInt(data.roomId)
}

export type RoomE2eePutWrapsOk = { ok: true; roomId: number; epoch: number; wraps: Record<string, string> }
export type RoomE2eePutWrapsErr = { ok: false; err: string }

export function parseRoomE2eePutWrapsPayload(data: unknown): RoomE2eePutWrapsOk | RoomE2eePutWrapsErr {
    if (!isPlainRecord(data)) return { ok: false, err: "Некорректные данные" }
    const roomId = parsePositiveInt(data.roomId)
    if (!roomId) return { ok: false, err: "Invalid room" }
    const epoch = data.epoch === undefined ? 0 : data.epoch
    if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch < 0 || epoch > 2147483647)
        return { ok: false, err: "Некорректная версия ключа" }
    const wrapsRaw = data.wraps
    if (!isPlainRecord(wrapsRaw)) return { ok: false, err: "Некорректные данные" }
    const pairs: [string, string][] = []
    for (const [key, v] of Object.entries(wrapsRaw)) {
        if (typeof v !== "string") return { ok: false, err: "Некорректные данные" }
        pairs.push([key, v])
    }
    if (pairs.length === 0) return { ok: false, err: "Пусто" }
    return { ok: true, roomId, epoch, wraps: Object.fromEntries(pairs) }
}
