export interface RoomCreatePayload {
    name?: unknown
}

export interface RoomIdPayload {
    roomId?: unknown
}

export interface RoomRenamePayload extends RoomIdPayload {
    name?: unknown
}

export interface RoomRemoveMemberPayload extends RoomIdPayload {
    userId?: unknown
}

export interface RoomAddMemberPayload extends RoomRemoveMemberPayload {
    peerUserId?: unknown
    username?: unknown
}

export interface RoomSetRolePayload extends RoomRemoveMemberPayload {
    role?: unknown
}

export type RoomRole = "member" | "moderator"
