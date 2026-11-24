import { isDatabaseId, requestFields } from "./chatContracts"
import { configuredServiceUrl, internalJson } from "./internalHttp"

export const roomBlockPeersPath = "/internal/room/block-peers"
export const ringingRecipientPath = "/internal/room/ringing-recipient"

export type RoomBlockPeersCommand = {
    userId: number
    peerId: number
}

export function parseRoomBlockPeersCommand(input: unknown): RoomBlockPeersCommand | null {
    const { userId, peerId } = requestFields(input)
    return isDatabaseId(userId) && isDatabaseId(peerId) && userId !== peerId ? { userId, peerId } : null
}

export async function requestRoomBlockPeers(command: RoomBlockPeersCommand): Promise<void> {
    await internalJson<Record<string, never>>(configuredServiceUrl("ROOM"), roomBlockPeersPath, command)
}

export function parseRingingRecipient(input: unknown): { roomId: string; recipientId: number } | null {
    const { roomId, recipientId } = requestFields(input)
    return typeof roomId === "string" && /^\d{1,10}:\d{1,10}$/.test(roomId) && isDatabaseId(recipientId)
        ? { roomId, recipientId }
        : null
}

export async function requestRingingRecipient(roomId: string, recipientId: number): Promise<boolean> {
    const { ringing } = await internalJson<{ ringing: boolean }>(configuredServiceUrl("ROOM"), ringingRecipientPath, {
        roomId,
        recipientId
    })
    return ringing
}
