
export interface RowUserId {
    id: number
}

export interface RowUserIdUsername {
    id: number
    username: string
}

export interface RowPasswordHash {
    password_hash: string
}

export interface RowMessageIdCreated {
    id: number
    created_at: Date
}

export interface RowRoomMemberUserId {
    user_id: number
}

export interface RowRoomName {
    name: string | null
}

export interface RowMid {
    mid: number
}

export interface RowMessageId {
    id: number
}

export interface RowUsername {
    username: string
}

export interface RowFriendListRow {
    id: number
    user_id: number
    friend_id: number
    status: string
    friendship_created: Date
    friend_username: string
    direction: string
    last_message: string | null
    last_message_at: Date | null
}

export interface RowRoomSidebar {
    id: number
    name: string | null
}

export interface RowRoomCreatedBy {
    created_by: number
}

export interface RowRoomListEntry {
    id: number
    name: string | null
    created_by: number
}

export interface RowRoomMemberId {
    room_id: number
}

export interface RowProfileUser {
    id: number
    username: string
    email: string
    is_guest: boolean
    guest_registration_pending: boolean
    profile_status: string | null
    profile_bio: string | null
    profile_avatar: string | null
    profile_banner: string | null
    profile_avatar_effect: string
    profile_banner_effect: string
    profile_banner_sticker: string
    created_at: Date
    dm_public_key: string | null
}

export interface RowFriendAvatarPlanRow {
    id: number
    username: string
    profile_avatar: string | null
    profile_avatar_effect: string
    plan_slug: string | null
}

export interface RowFriendPreview {
    friend_id: number
    friend_username: string
}

export interface RowLastMessagePreview {
    sender_username: string
    content: string
    is_dm_e2ee?: boolean
    sender_dm_public_key?: string | null
    receiver_dm_public_key?: string | null
}

export interface RowRoomMember {
    id: number
    username: string
}

export interface RowFriendshipPending {
    user_id: number
}
