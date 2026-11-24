
export type ScreenShareLimitsWire = {
    targetLongSide: number
    jpegQuality: number
    remoteUiFps: number
    captureIntervalMs: number
}

export type PlanLimitsWire = {
    maxRoomMembers: number
    maxPartySockets: number
    maxVoiceMessageSec: number
    maxScreenBroadcastFps: number
    maxAttachmentBytes: number
    screenShare: ScreenShareLimitsWire
    profileBannerAllowed: boolean
    profileBannerEffectsAllowed: boolean
    avatarEffectsAllowed: boolean
    profileAvatarEffectIds?: readonly string[]
    profileBannerEffectIds?: readonly string[]
    userSummary: string
    displayName: string
}

export type SubscriptionMeResponse = {
    planSlug: string
    limits: PlanLimitsWire
}
