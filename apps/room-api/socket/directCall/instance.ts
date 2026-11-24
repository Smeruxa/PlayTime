import type { CallRoomJson, ExpectedCallInstance } from "./callStore"

export type CallInstance = Pick<CallRoomJson, "instance_id" | "expires_at">

export function callGeneration(room: CallInstance): string {
    return room.instance_id === undefined ? `legacy:${room.expires_at ?? ""}` : `instance:${room.instance_id}`
}

export function sameCallInstance(first: CallInstance, second: CallInstance): boolean {
    return callGeneration(first) === callGeneration(second)
}

export function expectCallInstance(room: CallInstance): ExpectedCallInstance {
    return room.instance_id === undefined
        ? { expectedInstanceId: null, expectedExpiresAt: room.expires_at ?? null }
        : { expectedInstanceId: room.instance_id }
}

export function isCallParticipant(room: CallRoomJson, userId: number): boolean {
    return userId === room.beginer_id || userId === room.receiver_id
}
