export type Message = {
    me: boolean
    text: string
    data: number
}

export type UserProps = {
    name: string
    is_room: boolean
    id: number
    roomCreatedBy?: number
    archived?: boolean
}

export type MessageReplyWire = {
    id: number
    from: string
    preview: string
}

export type MessageType = {
    sender_id?: number
    receiver_id?: number
    id: number
    sender_username: string
    receiver_username: string
    content: string
    created_at: string
    read: boolean
    me: boolean
    reply?: MessageReplyWire | null
    is_dm_e2ee?: boolean
    senderDmPublicKey?: string | null
    receiverDmPublicKey?: string | null
    voiceStorageKey?: string | null
    voiceDurationSec?: number | null
    attachmentKey?: string | null
    attachmentMime?: string | null
    attachmentFilename?: string | null
    attachmentSize?: number | null
}

export type CallProps = {
    ownershipRevision?: number
    peerOwnershipRevision?: number
    participantIds?: number[]
    names: (string | null)[]
    roomId: string | number
    incoming: boolean
    isParty?: boolean
    confirmed?: boolean
    revision?: number
}

export type UserPublicProfile = {
    userId?: number
    archived?: boolean
    username: string
    email?: string
    status: string
    bio: string
    avatar: string | null
    profileBanner?: string | null
    profileAvatarEffect?: string | null
    profileBannerEffect?: string | null
    profileBannerSticker?: string | null
    dmPublicKey?: string | null
    createdAt: string
    isSelf: boolean
}
