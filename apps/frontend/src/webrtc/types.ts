export type WebrtcSignalType = "offer" | "answer" | "ice"

export type WebrtcContext = "direct" | "party"

export type IceServerConfig = {
    urls: string | string[]
    username?: string
    credential?: string
}

export type WebrtcSignalIncoming = {
    fromOwnershipRevision?: number
    targetOwnershipRevision?: number
    roomId: string | number
    context: WebrtcContext
    type: WebrtcSignalType
    fromUserId: number
    fromUsername?: string
    payload: RTCSessionDescriptionInit | RTCIceCandidateInit
}

export type WebrtcConfigIncoming = {
    iceServers: IceServerConfig[]
}

export type RemotePeerMeta = {
    userId: number
    username: string
}
