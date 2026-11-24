import type { Socket } from "socket.io-client"
import { parseDmWallpaperState, type DmWallpaperState } from "../../../../shared/types/contracts/dmWallpaper"

export type DmWallpaperGetAck = { state?: DmWallpaperState; err?: string }

export type DmWallpaperSetAck = { err?: string }

export type DmWallpaperUpdatePayload = { peerUsername: string; peerUserId?: number; state: DmWallpaperState }

export function requestDmWallpaper(
    socket: Socket,
    peerUsername: string,
    callback: (ack: DmWallpaperGetAck) => void,
    peerUserId?: number
): void {
    socket.emit("dmWallpaper:get", { peerUsername, peerUserId }, (reply?: DmWallpaperGetAck) => {
        const state = parseDmWallpaperState(reply?.state)
        callback({ state: state ?? undefined, err: reply?.err })
    })
}

export function parseDmWallpaperUpdate(payload: DmWallpaperUpdatePayload): DmWallpaperUpdatePayload | null {
    const state = parseDmWallpaperState(payload?.state)
    return state ? { ...payload, state } : null
}

export function setDmWallpaperOnServer(
    socket: Socket,
    peerUsername: string,
    state: DmWallpaperState,
    callback: (ack: DmWallpaperSetAck) => void,
    peerUserId?: number
): void {
    socket.emit("dmWallpaper:set", { peerUsername, peerUserId, state }, callback)
}
