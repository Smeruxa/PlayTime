import type { CallMediaEpoch } from "./directCall"
export type WebrtcSignalType = "offer" | "answer" | "ice"

export type WebrtcContext = "direct" | "party"

export interface WebrtcSignalPayload extends CallMediaEpoch {
    roomId?: string | number
    context?: WebrtcContext
    type?: WebrtcSignalType
    targetUserId?: number
    payload?: Record<string, unknown>
}

export interface WebrtcSignalIncoming {
    roomId: string | number
    context: WebrtcContext
    type: WebrtcSignalType
    fromOwnershipRevision?: number
    targetOwnershipRevision?: number
    fromUserId: number
    fromUsername?: string
    payload: Record<string, unknown>
}

export interface WebrtcConfigPayload {
    iceServers: Array<{
        urls: string | string[]
        username?: string
        credential?: string
    }>
}

export interface WebrtcScreenStatePayload extends CallMediaEpoch {
    roomId?: string | number
    context?: WebrtcContext
    active?: boolean
}

export interface WebrtcScreenStateIncoming {
    roomId: string | number
    context: WebrtcContext
    fromOwnershipRevision?: number
    targetOwnershipRevision?: number
    fromUserId: number
    fromUsername?: string
    active: boolean
}
