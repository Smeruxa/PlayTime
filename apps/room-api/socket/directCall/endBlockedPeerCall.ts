import type { RoomBlockPeersCommand } from "../../../shared/runtime/roomContracts"
import type { FeatureIo } from "../../../shared/socket/featureContext"
import { expectCallInstance, isCallParticipant } from "./instance"
import { callStore } from "./redisService"
import { clearCallRingTimeout } from "./ringTimeout"

export async function endBlockedPeerCall(
    { userId, peerId }: RoomBlockPeersCommand,
    isBlocked: (userId: number, peerId: number) => Promise<boolean>,
    io?: Pick<FeatureIo, "to">
): Promise<void> {
    if (userId === peerId) return
    const { roomId, room } = await callStore.current(userId)
    if (!roomId || !room || !isCallParticipant(room, userId) || !isCallParticipant(room, peerId)) return
    if (!(await isBlocked(userId, peerId))) return
    const ended = await callStore.transition(
        roomId,
        userId,
        "end",
        {
            internal: true,
            ...expectCallInstance(room)
        },
        false
    )
    if (ended.kind !== "ended") return
    clearCallRingTimeout(roomId, ended.room ?? room)
    for (const id of [userId, peerId]) io?.to(String(id)).emit("call:ended", { roomId })
}
