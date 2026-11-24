import type { AccessTokenPayload } from "../types/contracts/accessSession"

export interface AuthedUser {
    id: number
    username: string
}

type SocketUser = { id?: number; userId?: number; username: string }

export type RoomTarget = string | string[]
export type FeatureListener = { handle(...args: unknown[]): unknown }["handle"]

export interface FeatureRemoteSocket {
    id: string
    user?: SocketUser
    handshake: { auth: Record<string, unknown> }
    data: { accessSession?: AccessTokenPayload; callEndpointReady?: Promise<unknown> }
    emit(event: string, ...args: unknown[]): boolean
    leave(room: string): void | Promise<void>
}

export interface FeatureRooms {
    emit(event: string, ...args: unknown[]): boolean
    emitConfirmed?(event: string, ...args: unknown[]): Promise<void>
    fetchSockets(): Promise<FeatureRemoteSocket[]>
    disconnectSockets(close?: boolean): void
    socketsLeave(room: string): void
}

export interface FeatureIo {
    to(rooms: RoomTarget): FeatureRooms
    in(rooms: RoomTarget): FeatureRooms
    serverSideEmit(event: string, ...args: unknown[]): boolean
}

export interface FeatureSocket extends FeatureRemoteSocket {
    rooms: Set<string>
    nsp: Pick<FeatureIo, "in"> & { server: FeatureIo }
    on(event: string, handler: FeatureListener): void
    join(room: string): void | Promise<void>
    to(rooms: RoomTarget): FeatureRooms
}

export interface FeatureContext {
    io: FeatureIo
    socket: FeatureSocket
    user: AuthedUser
}

export function resolveAuthedUser(socket: { user?: SocketUser }): AuthedUser | null {
    const u = socket.user
    if (!u?.username) return null
    const id = u.id ?? u.userId
    if (typeof id !== "number" || !Number.isFinite(id)) return null
    return { id, username: u.username }
}
