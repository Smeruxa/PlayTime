import nacl from "tweetnacl"
import type { Socket } from "socket.io-client"
import { decryptDmRawBytes, encryptDmRawBytes, getDmPublicKeyB64, getDmSecretKey } from "../../dmE2ee"
import { checkMessageKey } from "../../peerKeyTrust"
import { currentKeyUserId } from "../../keyVault"
import { fetchRoomE2eeBundle, loadRoomSymKeyFromStorage, putRoomWraps, saveRoomSymKeyToStorage, type RoomKey } from "../../roomE2ee"

function trusted(id: number, key: string, owner: number, name?: string, historical = false) {
    return id === owner ? key === getDmPublicKeyB64(owner) : checkMessageKey(id, key, name, historical)
}

export async function ensureRoomSymmetricKey(
    socket: Socket, roomId: number, owner: number | null, setError: (error: string | null) => void, requestedEpoch?: number
): Promise<RoomKey | null> {
    if (requestedEpoch !== undefined && requestedEpoch < 0) return null
    if (requestedEpoch !== undefined) {
        const cached = loadRoomSymKeyFromStorage(roomId, requestedEpoch)
        if (cached) return { epoch: requestedEpoch, key: cached }
    }
    const secret = getDmSecretKey(owner)
    if (!secret || !owner) { setError("Нет ключа шифрования"); return null }
    try {
        for (let attempt = 0; attempt < 3; attempt++) {
            const bundle = await fetchRoomE2eeBundle(socket, roomId, requestedEpoch)
            if (currentKeyUserId() !== owner) return null
            if ("err" in bundle) throw new Error(bundle.err)
            const epoch = bundle.epoch ?? 0
            if (requestedEpoch !== undefined && requestedEpoch !== epoch) return null
            let key = loadRoomSymKeyFromStorage(roomId, epoch)
            if (key && bundle.myWrap) return { epoch, key }
            if (bundle.myWrap) {
                const wrap = bundle.myWrap
                const member = bundle.members.find(m => wrap.wrapperUserId ? m.id === wrap.wrapperUserId : m.dmPublicKey === wrap.wrapperDmPublicKey)
                const signerId = wrap.wrapperUserId ?? member?.id
                const historical = epoch < (bundle.currentEpoch ?? epoch)
                if (!signerId || (!historical && member?.dmPublicKey !== wrap.wrapperDmPublicKey)
                    || !trusted(signerId, wrap.wrapperDmPublicKey, owner, member?.username, historical))
                    throw new Error("Проверьте ключ участника, передавшего ключ комнаты")
                key = decryptDmRawBytes(wrap.ciphertext, secret, wrap.wrapperDmPublicKey)
                if (key?.length !== nacl.secretbox.keyLength) throw new Error("Не удалось восстановить ключ комнаты")
            } else if (!bundle.wrapCount && requestedEpoch === undefined) {
                key = nacl.randomBytes(nacl.secretbox.keyLength)
                const wraps: Record<string, string> = {}
                for (const member of bundle.members) {
                    if (!member.dmPublicKey) continue
                    if (!trusted(member.id, member.dmPublicKey, owner, member.username))
                        throw new Error("Проверьте изменившийся ключ участника комнаты")
                    wraps[member.id] = encryptDmRawBytes(key, member.dmPublicKey, secret)
                }
                if (!(await putRoomWraps(socket, roomId, wraps, epoch)).ok) continue
            } else if (requestedEpoch === undefined && attempt < 2) {
                await new Promise(resolve => setTimeout(resolve, 700))
                continue
            } else return null
            await saveRoomSymKeyToStorage(roomId, key, epoch, owner)
            return { epoch, key }
        }
        throw new Error("Не удалось согласовать ключ комнаты. Обновите чат")
    } catch (error) {
        if (currentKeyUserId() === owner) setError(error instanceof Error ? error.message : "Не удалось получить ключ комнаты")
        return null
    }
}
