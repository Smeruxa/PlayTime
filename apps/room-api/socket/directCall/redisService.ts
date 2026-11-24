import { redis } from "../../../shared/redis"
import { createCallStore, ROOM_PREFIX, type CallRoomJson } from "./callStore"

export { ROOM_PREFIX, type CallRoomJson }
export const callStore = createCallStore(redis)
export const getRoom = callStore.get
export const deleteRoom = callStore.remove
export const getAllRooms = callStore.list

export async function saveRoom(roomId: string, room: CallRoomJson | { toJSON(): CallRoomJson }): Promise<void> {
    const value = "toJSON" in room ? room.toJSON() : room
    await callStore.importLegacy(roomId, value)
}

export async function initializeDirectCalls(): Promise<void> {
    await callStore.repairLegacyRooms()
}
