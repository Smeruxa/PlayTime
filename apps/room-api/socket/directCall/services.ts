import type { FeatureIo } from "../../../shared/socket/featureContext"
import type { IncomingCallPush } from "../../../shared/types/contracts/directCall"
import type { CallRoomJson } from "./callStore"

type CallParticipant = { id: number; username: string }

export type DirectCallServices = {
    resolvePeer: (peerUserId: unknown, username: unknown) => Promise<CallParticipant | null>
    users: (ids: number[]) => Promise<CallParticipant[]>
    peerEventRoom: (recipientId: number, participantIds: number[]) => Promise<string>
    canCall: (userId: number, peerId: number) => Promise<boolean>
    screenFps: (userId: number) => Promise<number>
    enqueueIncomingCall: (input: IncomingCallPush) => Promise<void>
    logEnded?: (io: FeatureIo, room: CallRoomJson) => Promise<void>
}
