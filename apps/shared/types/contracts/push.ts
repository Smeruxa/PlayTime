export type PushTarget =
    | { version: 1; userId: number; kind: "chat"; id: number; isRoom: boolean; name: string }
    | { version: 1; userId: number; kind: "call" }

export type PushEvent = {
    eventKey: string
    chatKey: string
    senderId: number
    recipients: number[]
    roomId?: number
    messageId?: number
    callRoomId?: string
    target: PushTarget
    title: string
    expiresAt: number
}
