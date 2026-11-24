import type { FeatureContext } from "../../../shared/socket/featureContext"
import { pool } from "../../../shared/deps"
import { socketAck } from "../../../shared/types/socket/ack"
import { normalizeUsername } from "../messages/helpers"
import { resolvePeer } from "../peerIdentity"
import { areFriends } from "./acceptedContacts"
import type {
    ProfileGetDmPublicKeyAck,
    ProfileGetDmPublicKeyPayload,
    ProfileSetDmPublicKeyAck,
    ProfileSetDmPublicKeyPayload
} from "./contracts"

export function registerDmPublicKeys({ socket, user }: FeatureContext): void {
    const uid = user.id

    socket.on("profile:setDmPublicKey", async (data: ProfileSetDmPublicKeyPayload, callback: unknown) => {
        const cb = socketAck<ProfileSetDmPublicKeyAck>(callback)
        if (!cb) return
        try {
            const raw = data?.publicKey
            if (raw === null || raw === "") {
                if (data.replaceExisting !== true) return cb({ success: false, err: "Подтвердите замену ключа" })
                await pool.query("UPDATE users SET dm_public_key = NULL WHERE id = $1", [uid])
                return cb({ success: true })
            }
            if (typeof raw !== "string") return cb({ success: false, err: "Некорректный ключ" })
            const pk = raw.trim()
            if (pk.length > 200) return cb({ success: false, err: "Некорректный ключ" })
            const buf = Buffer.from(pk, "base64")
            if (buf.length !== 32) return cb({ success: false, err: "Ожидается ключ Curve25519 (32 байта, base64)" })
            const updated = await pool.query(
                "UPDATE users SET dm_public_key = $1 WHERE id = $2 AND (dm_public_key IS NULL OR dm_public_key = $1 OR $3::boolean)",
                [pk, uid, data.replaceExisting === true]
            )
            if (updated.rowCount === 0)
                return cb({
                    success: false,
                    err: "Ключ аккаунта уже изменился на другом устройстве. Восстановите копию ключей."
                })
            cb({ success: true })
        } catch (e) {
            console.error("profile:setDmPublicKey", e)
            cb({ success: false, err: "Не удалось сохранить ключ" })
        }
    })

    socket.on("profile:getDmPublicKey", async (data: ProfileGetDmPublicKeyPayload, callback: unknown) => {
        const cb = socketAck<ProfileGetDmPublicKeyAck>(callback)
        if (!cb) return
        try {
            const un = normalizeUsername(data?.username)
            const peer = await resolvePeer(data?.peerUserId, un, { allowArchived: true })
            if (!peer) return cb({ err: "Некорректный пользователь" })
            const row = await pool.query<{ id: number; dm_public_key: string | null }>(
                "SELECT id, dm_public_key FROM users WHERE id = $1",
                [peer.id]
            )
            if (row.rows.length === 0) return cb({ err: "Пользователь не найден" })
            const target = row.rows[0]
            if (!(await areFriends(uid, target.id))) return cb({ err: "Доступно только друзьям" })
            cb({ publicKey: target.dm_public_key })
        } catch (e) {
            console.error("profile:getDmPublicKey", e)
            cb({ err: "Ошибка" })
        }
    })
}
