import type { FeatureContext, FeatureIo } from "../../../shared/socket/featureContext"
import type { CallStateWire } from "../../../shared/types/contracts/directCall"
import type { CallRoomJson } from "./callStore"
import { isCallParticipant, sameCallInstance } from "./instance"
import { callActor, mediaActor, mediaState } from "./ownership"
import { getRoom } from "./redisService"
import type { DirectCallServices } from "./services"

const inactiveMedia = { active: false, canClaim: false, ownershipRevision: 0 }
type CallParticipants = Pick<CallStateWire, "caller" | "receiver">

export function createCallState(
    { io, socket, user }: FeatureContext,
    { users, peerEventRoom }: Pick<DirectCallServices, "users" | "peerEventRoom">
) {
    async function currentCall(roomId: string, expected?: CallRoomJson): Promise<CallRoomJson | null> {
        const room = await getRoom(roomId)
        if (!room || !isCallParticipant(room, user.id) || (expected && !sameCallInstance(room, expected))) return null
        return room
    }

    async function resolveParticipants(room: CallRoomJson): Promise<CallParticipants | null> {
        const participants = await users([room.beginer_id, room.receiver_id])
        const caller = participants.find(({ id }) => id === room.beginer_id)
        const receiver = participants.find(({ id }) => id === room.receiver_id)
        return caller && receiver ? { caller, receiver } : null
    }

    function present(roomId: string, room: CallRoomJson, { caller, receiver }: CallParticipants): CallStateWire {
        return {
            roomId,
            status: room.status,
            revision: room.revision ?? 1,
            caller: { ...caller, ownershipRevision: room.owners?.[String(caller.id)]?.ownershipRevision },
            receiver: { ...receiver, ownershipRevision: room.owners?.[String(receiver.id)]?.ownershipRevision },
            media:
                !room.owners && callActor(socket, user.id)
                    ? inactiveMedia
                    : mediaState(room, user.id, mediaActor(socket, user.id)),
            expiresAt: room.expires_at
        }
    }

    async function load(roomId: string, expected?: CallRoomJson) {
        const initial = await currentCall(roomId, expected)
        if (!initial) return null
        const participants = await resolveParticipants(initial)
        if (!participants) return null
        const room = await currentCall(roomId, initial)
        return room ? { room, state: present(roomId, room, participants) } : null
    }

    async function publish(roomId: string, expected: CallRoomJson) {
        const initial = await currentCall(roomId, expected)
        if (!initial) return null
        const ids = [initial.beginer_id, initial.receiver_id]
        const audience = async (id: number) => {
            const target = await peerEventRoom(id, ids)
            return { id, target, devices: await io.in(target).fetchSockets() }
        }
        const [participants, caller, receiver] = await Promise.all([
            resolveParticipants(initial),
            audience(initial.beginer_id),
            audience(initial.receiver_id)
        ])
        if (!participants) return null
        const room = await currentCall(roomId, initial)
        if (!room) return null
        const state = present(roomId, room, participants)
        for (const { id, devices } of [caller, receiver]) {
            for (const device of devices) {
                const actor = callActor(device, id)
                if (!room.owners) {
                    device.emit("call:state", { ...state, media: actor ? inactiveMedia : undefined })
                } else if (actor || room.owners[String(id)]?.socketId === device.id) {
                    device.emit("call:state", {
                        ...state,
                        media: mediaState(room, id, actor ?? mediaActor(device, id))
                    })
                }
            }
        }
        return { room, state, receiverTarget: receiver.target }
    }

    return { load, publish }
}

export function emitCallConfirmed(io: FeatureIo, roomId: string, room: CallRoomJson): void {
    for (const id of [room.beginer_id, room.receiver_id]) {
        const owner = room.owners?.[String(id)]
        if (!room.owners || owner)
            io.to(owner?.socketId ?? String(id)).emit("call:confirmed", {
                roomId,
                ownershipRevision: owner?.ownershipRevision
            })
    }
}
