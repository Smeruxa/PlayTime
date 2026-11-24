export interface CallStartPayload {
    peerUserId?: unknown
    username?: string
}

export type CallEndpoint = {
    endpointKey: string
    socketId: string
    modern?: boolean
    sessionKey?: string
}

export type CallOwner = CallEndpoint & { ownershipRevision: number }

export type CallRoomJson = {
    instance_id?: string
    legacyStarter?: CallEndpoint
    owners?: Record<string, CallOwner>
    takeoverEnabled?: boolean
    status: "request_receiver" | "in_call"
    beginer_id: number
    receiver_id: number
    confirmed_at?: number
    expires_at?: number
    revision?: number
}

export interface CallStateWire {
    roomId: string
    status: "request_receiver" | "in_call"
    revision: number
    media?: { active: boolean; canClaim: boolean; ownershipRevision: number }
    caller: { id: number; username: string; ownershipRevision?: number }
    receiver: { id: number; username: string; ownershipRevision?: number }
    expiresAt?: number
}

export type CallStartAck =
    | { success: true; roomId: string; confirmed?: boolean; state?: CallStateWire }
    | { err: string }

export interface CallClaimPayload {
    roomId?: string
    expectedOwnershipRevision?: number
}

export interface CallMediaEpoch {
    ownershipRevision?: number
    targetOwnershipRevision?: number
}

export interface CallConfirmPayload {
    roomId?: string
    accept?: boolean
}

export interface CallRoomBroadcastPayload extends CallMediaEpoch {
    roomId?: string
    voiceData?: unknown
    sampleRate?: number
}

export interface CallRoomScreenPayload extends CallMediaEpoch {
    roomId?: string
    frame?: unknown
}

export interface CallRoomIdPayload extends CallMediaEpoch {
    roomId?: string
}

export type CallResumeAck = { success: true; status: string } | { ended: true } | { err: string }

export interface CallNoAnswerPayload {
    roomId?: string
    username?: string
}

export type IncomingCallPush = {
    roomId: string
    senderId: number
    senderUsername: string
    recipientId: number
    expiresAt: number
}
