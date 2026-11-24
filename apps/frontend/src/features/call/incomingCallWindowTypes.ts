export type IncomingCallWindowState = {
    roomId: string
    from: string
    expiresAt?: number
    avatar?: string | null
    profileBanner?: string | null
    profileAvatarEffect?: string | null
    profileBannerEffect?: string | null
    profileBannerSticker?: string | null
    busy?: boolean
    error?: string | null
}

export type IncomingCallAnswer = { roomId: string; accept: boolean }

export type IncomingCallWindowBridge = {
    onUpdate: (callback: (state: IncomingCallWindowState) => void) => () => void
    answer: (answer: IncomingCallAnswer) => void
}
