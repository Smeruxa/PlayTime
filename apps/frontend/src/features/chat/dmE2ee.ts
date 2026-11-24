import { currentKeyUserId, getOrCreateSecret, readSecret, writeSecret } from "./keyVault"
import { checkPeerKey } from "./peerKeyTrust"
import { MessageSendError } from "./sendWithReceipt"
import nacl from "tweetnacl"
import naclUtil from "tweetnacl-util"
import type { Socket } from "socket.io-client"

export const DM_E2EE_PREFIX = "E2E1:"
const LEGACY_LS_SK = "playtime_dm_secret_key_b64"

export async function migrateLegacyDmKeyForUser(userId: number, remote: string | null): Promise<void> {
    if (!remote || userId !== currentKeyUserId()) return
    const legacy = localStorage.getItem(LEGACY_LS_SK)
    if (!legacy) return
    try {
        const key = nacl.box.keyPair.fromSecretKey(naclUtil.decodeBase64(legacy)).publicKey
        if (naclUtil.encodeBase64(key) !== remote) return
    } catch { return }
    const persisted = await getOrCreateSecret("dm", userId, () => legacy, value => Boolean(value))
    if (persisted === legacy && localStorage.getItem(LEGACY_LS_SK) === legacy) localStorage.removeItem(LEGACY_LS_SK)
}

export function getDmSecretKey(userId: number | null | undefined): Uint8Array | null {
    if (userId == null || !Number.isFinite(userId) || userId <= 0) return null
    const b64 = readSecret("dm", userId)
    if (!b64) return null
    try {
        const sk = naclUtil.decodeBase64(b64)
        return sk.length === nacl.box.secretKeyLength ? sk : null
    } catch {
        return null
    }
}

export function getDmPublicKeyB64(userId: number | null | undefined): string | null {
    const sk = getDmSecretKey(userId)
    if (!sk) return null
    const pair = nacl.box.keyPair.fromSecretKey(sk)
    return naclUtil.encodeBase64(pair.publicKey)
}

export async function createAndStoreDmKeyPair(userId: number): Promise<string> {
    if (!Number.isFinite(userId) || userId <= 0) throw new Error("invalid userId")
    const pair = nacl.box.keyPair()
    await writeSecret("dm", naclUtil.encodeBase64(pair.secretKey), userId)
    return naclUtil.encodeBase64(pair.publicKey)
}

export async function ensureDmKeyPair(userId: number): Promise<string> {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("invalid userId")
    const secret = await getOrCreateSecret(
        "dm",
        userId,
        () => naclUtil.encodeBase64(nacl.box.keyPair().secretKey),
        (value) => {
            try {
                return naclUtil.decodeBase64(value).length === nacl.box.secretKeyLength
            } catch {
                return false
            }
        }
    )
    return naclUtil.encodeBase64(nacl.box.keyPair.fromSecretKey(naclUtil.decodeBase64(secret)).publicKey)
}

export function profileSetDmPublicKey(
    socket: Socket,
    publicKeyB64: string | null,
    replaceExisting = false
): Promise<{ ok: boolean; err?: string }> {
    return new Promise((resolve) => {
        socket.emit(
            "profile:setDmPublicKey",
            { publicKey: publicKeyB64, replaceExisting },
            (res: { success?: boolean; err?: string }) => {
                if (res?.success) resolve({ ok: true })
                else resolve({ ok: false, err: res?.err || "Ошибка" })
            }
        )
    })
}

export function fetchFriendDmPublicKey(
    socket: Socket,
    username: string,
    signal?: AbortSignal,
    peerUserId?: number
): Promise<string | null> {
    const expectedOwnerId = currentKeyUserId()
    return new Promise((resolve, reject) => {
        let settled = false
        const cleanup = () => {
            socket.off("disconnect", unavailable)
            signal?.removeEventListener("abort", unavailable)
        }
        const unavailable = () => {
            if (settled) return
            settled = true
            cleanup()
            if (signal)
                reject(new MessageSendError("Ключ собеседника не получен. Повторите отправку после подключения.", true))
            else resolve(null)
        }
        socket.on("disconnect", unavailable)
        signal?.addEventListener("abort", unavailable, { once: true })
        if (signal?.aborted || !socket.connected) {
            unavailable()
            return
        }
        try {
            socket
                .timeout(8000)
                .emitWithAck("profile:getDmPublicKey", {
                    username,
                    ...(peerUserId !== undefined ? { peerUserId } : {})
                })
                .then((res: { publicKey?: string | null; err?: string }) => {
                    if (settled) return
                    if (currentKeyUserId() !== expectedOwnerId) {
                        settled = true
                        cleanup()
                        resolve(null)
                        return
                    }
                    const key = res?.err ? null : (res?.publicKey ?? null)
                    const trustedKey =
                        key && checkPeerKey(peerUserId !== undefined ? `dm:${peerUserId}` : username, key, username)
                            ? key
                            : null
                    settled = true
                    cleanup()
                    resolve(trustedKey)
                })
                .catch(unavailable)
        } catch {
            unavailable()
        }
    })
}

export function encryptDmPlaintext(plaintext: string, peerPublicKeyB64: string, mySecretKey: Uint8Array): string {
    const peerPub = naclUtil.decodeBase64(peerPublicKeyB64)
    if (peerPub.length !== nacl.box.publicKeyLength) throw new Error("bad peer key")
    const msg = naclUtil.decodeUTF8(plaintext)
    const nonce = nacl.randomBytes(nacl.box.nonceLength)
    const boxed = nacl.box(msg, nonce, peerPub, mySecretKey)
    const wire = { n: naclUtil.encodeBase64(nonce), b: naclUtil.encodeBase64(boxed) }
    return DM_E2EE_PREFIX + JSON.stringify(wire)
}

export function encryptDmRawBytes(plain: Uint8Array, peerPublicKeyB64: string, mySecretKey: Uint8Array): string {
    const peerPub = naclUtil.decodeBase64(peerPublicKeyB64)
    if (peerPub.length !== nacl.box.publicKeyLength) throw new Error("bad peer key")
    if (plain.length > 4096) throw new Error("payload too large")
    const nonce = nacl.randomBytes(nacl.box.nonceLength)
    const boxed = nacl.box(plain, nonce, peerPub, mySecretKey)
    const wire = { n: naclUtil.encodeBase64(nonce), b: naclUtil.encodeBase64(boxed) }
    return DM_E2EE_PREFIX + JSON.stringify(wire)
}

export function decryptDmRawBytes(
    stored: string,
    mySecretKey: Uint8Array,
    senderPublicKeyB64: string
): Uint8Array | null {
    if (!stored.startsWith(DM_E2EE_PREFIX)) return null
    let wire: { n?: string; b?: string }
    try {
        wire = JSON.parse(stored.slice(DM_E2EE_PREFIX.length)) as { n?: string; b?: string }
    } catch {
        return null
    }
    if (typeof wire.n !== "string" || typeof wire.b !== "string") return null
    const nonce = naclUtil.decodeBase64(wire.n)
    const boxed = naclUtil.decodeBase64(wire.b)
    const senderPub = naclUtil.decodeBase64(senderPublicKeyB64)
    const opened = nacl.box.open(boxed, nonce, senderPub, mySecretKey)
    return opened
}

export function decryptDmCiphertext(
    stored: string,
    mySecretKey: Uint8Array,
    senderDmPublicKeyB64: string | null | undefined,
    receiverDmPublicKeyB64: string | null | undefined,
    iAmSender: boolean
): string {
    if (!stored.startsWith(DM_E2EE_PREFIX)) return stored
    const otherB64 = iAmSender ? receiverDmPublicKeyB64 : senderDmPublicKeyB64
    if (!otherB64) return "🔒 Защищено сквозным шифрованием"
    let wire: { n?: string; b?: string }
    try {
        wire = JSON.parse(stored.slice(DM_E2EE_PREFIX.length)) as { n?: string; b?: string }
    } catch {
        return "🔒 Защищено сквозным шифрованием"
    }
    if (typeof wire.n !== "string" || typeof wire.b !== "string") return "🔒 Защищено сквозным шифрованием"
    const nonce = naclUtil.decodeBase64(wire.n)
    const boxed = naclUtil.decodeBase64(wire.b)
    const otherPub = naclUtil.decodeBase64(otherB64)
    const opened = nacl.box.open(boxed, nonce, otherPub, mySecretKey)
    if (!opened) return "[Не удалось расшифровать]"
    return naclUtil.encodeUTF8(opened)
}
