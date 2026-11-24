export function parseDirectCallRoom(roomId: string): { callerId: number; receiverId: number } | null {
    const parts = roomId.split(":")
    if (parts.length !== 2 && parts.length !== 3) return null
    if (parts.length === 3 && !/^[a-f0-9-]{36}$/i.test(parts[2])) return null
    const callerId = Number(parts[0])
    const receiverId = Number(parts[1])
    if (!Number.isSafeInteger(callerId) || callerId <= 0 || !Number.isSafeInteger(receiverId) || receiverId <= 0 || callerId === receiverId) return null
    return { callerId, receiverId }
}
