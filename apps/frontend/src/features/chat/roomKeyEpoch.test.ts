import nacl from "tweetnacl"
import util from "tweetnacl-util"
import type { Socket } from "socket.io-client"
import { encryptDmRawBytes, migrateLegacyDmKeyForUser } from "./dmE2ee"
import { ensureRoomSymmetricKey } from "./hooks/useChatMessages/ensureRoomSymmetricKey"
import { trustPeerKey } from "./peerKeyTrust"
import { hydrateKeys, readSecret } from "./keyVault"
import { decryptRoomCiphertext, encryptRoomPlaintext, roomMessageEpoch } from "./roomE2ee"

test("unscoped private material migrates only to the matching published identity", async () => {
    const pair = nacl.box.keyPair()
    const secret = util.encodeBase64(pair.secretKey)
    const legacy = "playtime_dm_secret_key_b64"
    const keys: Record<string, Record<string, string>> = {}
    window.electronAPI = {
        readEncryptionKeys: async (id: number) => ({ ...keys[id] }),
        writeEncryptionKeys: async (id: number, value: Record<string, string>) => { keys[id] = { ...value } }
    } as unknown as Window["electronAPI"]
    try {
        localStorage.setItem(legacy, secret)
        await hydrateKeys(701)
        await migrateLegacyDmKeyForUser(701, null)
        await migrateLegacyDmKeyForUser(701, util.encodeBase64(nacl.box.keyPair().publicKey))
        expect(readSecret("dm", 701)).toBeNull()
        expect(localStorage.getItem(legacy)).toBe(secret)
        await hydrateKeys(702)
        await migrateLegacyDmKeyForUser(702, util.encodeBase64(pair.publicKey))
        expect(keys[702].dm).toBe(secret)
        expect(localStorage.getItem(legacy)).toBeNull()
    } finally {
        delete (window as Partial<Window>).electronAPI
        localStorage.clear()
    }
})

test("room generations retain separate keys and trust a superseded wrapper only in history", async () => {
    const own = nacl.box.keyPair()
    const oldSigner = nacl.box.keyPair()
    const currentSigner = nacl.box.keyPair()
    const ownerId = 712
    const oldPublic = util.encodeBase64(oldSigner.publicKey)
    const currentPublic = util.encodeBase64(currentSigner.publicKey)
    const previous = nacl.randomBytes(32)
    const current = nacl.randomBytes(32)
    const keys: Record<string, string> = { dm: util.encodeBase64(own.secretKey) }
    window.electronAPI = {
        readEncryptionKeys: async () => ({ ...keys }),
        writeEncryptionKeys: async (_id: number, value: Record<string, string>) => { Object.assign(keys, value) }
    } as unknown as Window["electronAPI"]
    try {
        await hydrateKeys(ownerId)
        trustPeerKey("dm:811", oldPublic, ownerId)
        trustPeerKey("dm:811", currentPublic, ownerId)
        let signer = oldSigner
        const socket = { timeout: () => ({
            emit: (_event: string, input: { epoch?: number }, ack: (error: null, result: unknown) => void) => {
                const epoch = input.epoch ?? 1
                const wrapper = epoch === 0 ? oldSigner : signer
                ack(null, { epoch, currentEpoch: 1, members: [{ id: 811, username: "peer", dmPublicKey: currentPublic }],
                    wrapCount: 1, myWrap: { wrapperUserId: 811, wrapperDmPublicKey: util.encodeBase64(wrapper.publicKey),
                        ciphertext: encryptDmRawBytes(epoch === 0 ? previous : current, util.encodeBase64(own.publicKey), wrapper.secretKey) } })
            }
        }) } as unknown as Socket
        expect(await ensureRoomSymmetricKey(socket, 815, ownerId, jest.fn())).toBeNull()
        expect((await ensureRoomSymmetricKey(socket, 815, ownerId, jest.fn(), 0))?.key).toEqual(previous)
        signer = currentSigner
        expect((await ensureRoomSymmetricKey(socket, 815, ownerId, jest.fn()))?.key).toEqual(current)
        const wire = encryptRoomPlaintext("новая версия", current, 1)
        expect(roomMessageEpoch(wire)).toBe(1)
        expect(decryptRoomCiphertext(wire, previous)).toBe("[Не удалось расшифровать]")
        expect(decryptRoomCiphertext(wire, current)).toBe("новая версия")
        expect(keys["room:815"]).toBe(util.encodeBase64(previous))
        expect(keys["room:815:1"]).toBe(util.encodeBase64(current))
    } finally {
        delete (window as Partial<Window>).electronAPI
        localStorage.clear()
    }
})
