export interface RoomErrorAck {
    err: string
}

export interface RoomCreateSuccessAck {
    success: true
    roomId: number
    name: string
}

export interface RoomRenameSuccessAck {
    success: true
    name: string
}

export interface RoomSuccessAck {
    success: true
}

export interface RoomGetSuccessPayload {
    id: number
    name: string
    created_by: number
    myId: number
    members: Array<{ id: number; username: string }>
}

export type RoomGetAck = RoomGetSuccessPayload | RoomErrorAck

export type RoomCreateAck = RoomCreateSuccessAck | RoomErrorAck

export type RoomVoiceLimits = {
    maxPartySockets: number
    maxScreenBroadcastFps: number
}
