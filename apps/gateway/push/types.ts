import type { PushTarget } from "../../shared/types/contracts/push"

export type { PushTarget } from "../../shared/types/contracts/push"

export type PushDelivery = {
    id: string
    deviceId: string
    token: string
    eventKey: string
    target: PushTarget
    title: string
    messageId: number | null
    callRoomId: string | null
    expiresAt: number
    attempts: number
}

export type PushResult = "sent" | "retry" | "invalid_token" | "rejected"

export type PushRegistration = {
    provider: "rustore"
    token: string
    enabled: boolean
    mutedChats: string[]
}
