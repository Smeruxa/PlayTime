import { currentKeyUserId, readSecret, snapshotKeys, writeSecret } from "./keyVault"
import nacl from "tweetnacl"
import naclUtil from "tweetnacl-util"
import type { Socket } from "socket.io-client"

export const ROOM_E2EE_PREFIX = "R2E1:"
export type RoomKey = { epoch: number; key: Uint8Array }
export type RoomWrap = { ciphertext: string; wrapperDmPublicKey: string; wrapperUserId?: number | null }
export type RoomE2eeMemberWire = { id: number; username: string; dmPublicKey: string | null }
export type RoomE2eeBundleResult =
    | { err: string }
    | { epoch?: number; currentEpoch?: number; members: RoomE2eeMemberWire[]; wrapCount: number; myWrap: RoomWrap | null }

function storageName(roomId: number, epoch: number): string {
    return epoch ? `room:${roomId}:${epoch}` : `room:${roomId}`
}

export function roomMessageEpoch(content: string): number {
    if (!content.startsWith(ROOM_E2EE_PREFIX)) return 0
    try {
        const epoch = JSON.parse(content.slice(ROOM_E2EE_PREFIX.length)).e ?? 0
        return Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : -1
    } catch { return -1 }
}

export function loadRoomSymKeyFromStorage(roomId: number, epoch = 0): Uint8Array | null {
    const b64 = readSecret(storageName(roomId, epoch))
    if (!b64) return null
    try {
        const key = naclUtil.decodeBase64(b64)
        return key.length === nacl.secretbox.keyLength ? key : null
    } catch { return null }
}

export async function saveRoomSymKeyToStorage(roomId: number, key: Uint8Array, epoch = 0, owner = currentKeyUserId()): Promise<void> {
    if (owner == null || owner !== currentKeyUserId()) throw new Error("Аккаунт изменился")
    await writeSecret(storageName(roomId, epoch), naclUtil.encodeBase64(key), owner)
}

export async function clearRoomSymKeyFromStorage(roomId: number): Promise<void> {
    const owner = currentKeyUserId()
    if (owner === null) return
    const prefix = `room:${roomId}`
    for (const name of Object.keys(snapshotKeys(owner))) {
        if (name === prefix || name.startsWith(prefix + ":")) await writeSecret(name, null, owner)
    }
}

export function encryptRoomPlaintext(plaintext: string, symKey: Uint8Array, epoch = 0): string {
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
    const boxed = nacl.secretbox(naclUtil.decodeUTF8(plaintext), nonce, symKey)
    return ROOM_E2EE_PREFIX + JSON.stringify({ e: epoch, n: naclUtil.encodeBase64(nonce), b: naclUtil.encodeBase64(boxed) })
}

export function decryptRoomCiphertext(stored: string, symKey: Uint8Array): string {
    if (!stored.startsWith(ROOM_E2EE_PREFIX)) return stored
    try {
        const wire = JSON.parse(stored.slice(ROOM_E2EE_PREFIX.length))
        const opened = nacl.secretbox.open(naclUtil.decodeBase64(wire.b), naclUtil.decodeBase64(wire.n), symKey)
        if (opened) return naclUtil.encodeUTF8(opened)
    } catch {}
    return "[Не удалось расшифровать]"
}

export function fetchRoomE2eeBundle(socket: Socket, roomId: number, epoch?: number): Promise<RoomE2eeBundleResult> {
    return new Promise((resolve) => {
        socket.timeout(8000).emit("room:e2eeBundle", { roomId, epoch, keyProtocol: 1 }, (error: Error | null, result?: RoomE2eeBundleResult) => {
            resolve(error || !result ? { err: "Нет ответа от сервера" } : result)
        })
    })
}

export function putRoomWraps(socket: Socket, roomId: number, wraps: Record<string, string>, epoch = 0): Promise<{ ok: boolean; err?: string }> {
    return new Promise((resolve) => {
        socket.timeout(8000).emit("room:e2eePutWraps", { roomId, wraps, epoch }, (error: Error | null, result?: { success?: boolean; err?: string }) => {
            resolve(!error && result?.success ? { ok: true } : { ok: false, err: result?.err || "Не удалось сохранить ключ комнаты" })
        })
    })
}
