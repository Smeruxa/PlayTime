export interface ProfileGetPayload {
    peerUserId?: unknown
    username?: unknown
}

export interface ProfilePublicView {
    userId?: number
    archived?: boolean
    username: string
    email?: string
    isGuest?: boolean
    registrationPending?: boolean
    status: string
    bio: string
    avatar: string | null
    profileBanner: string | null
    profileAvatarEffect: string
    profileBannerEffect: string
    profileBannerSticker: string
    createdAt: Date
    isSelf: boolean
    dmPublicKey?: string | null
}

export interface ProfileGetAck {
    err?: string
    profile?: ProfilePublicView
}

export interface ProfileUpdatePayload {
    status?: unknown
    bio?: unknown
    avatar?: unknown
    profileBanner?: unknown
    profileAvatarEffect?: unknown
    profileBannerEffect?: unknown
    profileBannerSticker?: unknown
}

export interface ProfileUpdateAck {
    success: boolean
    err?: string
}

export type FriendAvatarWire = {
    avatar: string | null
    profileAvatarEffect: string
}

export interface FriendsAvatarsPayload {
    byUserId?: unknown
}

export type FriendsAvatarsAck = Record<string, FriendAvatarWire>

export interface ProfileSetDmPublicKeyPayload {
    publicKey?: unknown
    replaceExisting?: unknown
}

export interface ProfileSetDmPublicKeyAck {
    success: boolean
    err?: string
}

export interface ProfileGetDmPublicKeyPayload {
    peerUserId?: unknown
    username?: unknown
}

export interface ProfileGetDmPublicKeyAck {
    err?: string
    publicKey?: string | null
}
