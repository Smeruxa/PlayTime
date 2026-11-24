import type { FeatureContext } from "../../../shared/socket/featureContext"
import { pool, parsePositiveInt } from "./helpers"
import { socketAck } from "../../../shared/types/socket/ack"
import { isValidDmE2eeEnvelope } from "../../utils/dmE2eeEnvelope"
import { parseRoomE2eeBundlePayload, parseRoomE2eePutWrapsPayload } from "./roomE2eePayload"

type MemberRow = { id: number; username: string; dm_public_key: string | null }
class RoomKeyRequestError extends Error {}

export type RoomE2eeBundleAck =
    | { err: string }
    | {
          epoch: number
          currentEpoch: number
          members: { id: number; username: string; dmPublicKey: string | null }[]
          wrapCount: number
          myWrap: { ciphertext: string; wrapperDmPublicKey: string; wrapperUserId: number | null } | null
      }

export default function registerRoomE2eeKeys({ socket, user }: FeatureContext): void {
    const uid = user.id

    socket.on("room:e2eeBundle", async (data: unknown, callback: unknown) => {
        const cb = socketAck<RoomE2eeBundleAck>(callback)
        if (!cb) return
        try {
            const roomId = parseRoomE2eeBundlePayload(data)
            if (!roomId) return cb({ err: "Invalid room" })
            const requested = data && typeof data === "object" && "epoch" in data ? data.epoch : undefined
            if (requested !== undefined && !(typeof requested === "number" && Number.isSafeInteger(requested) && requested >= 0 && requested <= 2147483647))
                return cb({ err: "Некорректная версия ключа" })
            const protocol = data && typeof data === "object" && "keyProtocol" in data && data.keyProtocol === 1
            const { rows } = await pool.query<{
                epoch: number
          currentEpoch: number
                current_epoch: number
                members: MemberRow[]
                wrap_count: number
                my_wrap: { ciphertext: string; wrapperDmPublicKey: string; wrapperUserId: number | null } | null
            }>(
                `WITH scope AS (
                    SELECT r.id, r.key_epoch, COALESCE($3::int, r.key_epoch) AS epoch FROM rooms r
                    JOIN room_members m ON m.room_id = r.id AND m.user_id = $2
                    WHERE r.id = $1 AND ($3::int IS NULL OR $3 <= r.key_epoch)
                ), wraps AS (
                    SELECT w.user_id, w.wrapper_user_id, w.wrapper_public_key, w.ciphertext
                    FROM room_e2ee_wraps w JOIN scope s ON w.room_id = s.id AND s.epoch = s.key_epoch
                    UNION ALL
                    SELECT h.user_id, h.wrapper_user_id, h.wrapper_public_key, h.ciphertext
                    FROM room_key_history h JOIN scope s ON h.room_id = s.id AND h.epoch = s.epoch
                    WHERE h.user_id = $2 AND s.epoch < s.key_epoch
                )
                SELECT s.epoch, s.key_epoch AS current_epoch,
                    (SELECT json_agg(json_build_object('id', u.id, 'username', u.username, 'dm_public_key', u.dm_public_key)
                     ORDER BY u.id) FROM room_members m JOIN users u ON u.id=m.user_id WHERE m.room_id=s.id) AS members,
                    (SELECT count(*)::int FROM wraps) AS wrap_count,
                    (SELECT json_build_object('ciphertext', w.ciphertext, 'wrapperDmPublicKey', w.wrapper_public_key,
                     'wrapperUserId', w.wrapper_user_id) FROM wraps w WHERE w.user_id=$2 AND w.wrapper_public_key IS NOT NULL) AS my_wrap
                FROM scope s`,
                [roomId, uid, requested ?? null]
            )
            const row = rows[0]
            if (!row) return cb({ err: "Нет доступа к комнате" })
            if (row.current_epoch > 0 && !protocol) return cb({ err: "Обновите PlayTime для доступа к новому ключу комнаты" })
            cb({
                epoch: row.epoch,
                currentEpoch: row.current_epoch,
                members: row.members.map(m => ({ id: m.id, username: m.username, dmPublicKey: m.dm_public_key })),
                wrapCount: row.wrap_count,
                myWrap: row.my_wrap
            })
        } catch (err) {
            console.error("room:e2eeBundle", err)
            cb({ err: "Ошибка" })
        }
    })

    socket.on("room:e2eePutWraps", async (data: unknown, callback: unknown) => {
        const cb = socketAck<{ success: true } | { err: string }>(callback)
        if (!cb) return
        const parsedIn = parseRoomE2eePutWrapsPayload(data)
        if (!parsedIn.ok) return cb({ err: parsedIn.err })
        const { roomId, wraps, epoch } = parsedIn
        const entries = Object.entries(wraps)

        try {
            const parsed: { targetUserId: number; cipher: string }[] = []
            for (const [targetIdStr, cipherVal] of entries) {
                const targetUserId = parsePositiveInt(targetIdStr)
                if (!targetUserId) return cb({ err: "Некорректный участник" })
                if (!isValidDmE2eeEnvelope(cipherVal)) return cb({ err: "Некорректное шифрование" })
                parsed.push({ targetUserId, cipher: cipherVal })
            }

            const client = await pool.connect()
            try {
                await client.query("BEGIN")
                const locked = await client.query<{ key_epoch: number }>("SELECT key_epoch FROM rooms WHERE id = $1 FOR UPDATE", [roomId])
                if (locked.rows[0]?.key_epoch !== epoch) throw new RoomKeyRequestError("Ключ комнаты изменился. Обновите чат")
                const membersRes = await client.query<{ user_id: number }>(
                    "SELECT user_id FROM room_members WHERE room_id = $1 ORDER BY user_id FOR SHARE",
                    [roomId]
                )
                const memberSet = new Set(membersRes.rows.map((r) => r.user_id))
                if (!memberSet.has(uid)) throw new RoomKeyRequestError("Нет доступа к комнате")
                for (const { targetUserId } of parsed) {
                    if (!memberSet.has(targetUserId)) throw new RoomKeyRequestError("Некорректный участник")
                }
                const cntRes = await client.query<{ c: string }>(
                    "SELECT COUNT(*)::text AS c FROM room_e2ee_wraps WHERE room_id = $1",
                    [roomId]
                )
                const existingCount = parseInt(cntRes.rows[0]?.c || "0", 10) || 0
                if (existingCount > 0) {
                    const authorized = await client.query("SELECT 1 FROM room_e2ee_wraps WHERE room_id=$1 AND user_id=$2", [roomId,uid])
                    if (!authorized.rows.length) throw new RoomKeyRequestError("Дождитесь ключа от существующего участника")
                    for (const { targetUserId } of parsed) {
                        const exists = await client.query(
                            "SELECT 1 FROM room_e2ee_wraps WHERE room_id = $1 AND user_id = $2",
                            [roomId, targetUserId]
                        )
                        if (exists.rows.length > 0) throw new RoomKeyRequestError("Ключ для этого участника уже есть")
                    }
                } else {
                    const needKeys = await client.query<{ user_id: number; dm_public_key: string | null }>(
                        `SELECT rm.user_id, u.dm_public_key
                         FROM room_members rm
                         JOIN users u ON u.id = rm.user_id
                         WHERE rm.room_id = $1`,
                        [roomId]
                    )
                    const withPub = needKeys.rows.filter((r) => r.dm_public_key != null && r.dm_public_key !== "")
                    if (withPub.length === 0)
                        throw new RoomKeyRequestError("Нужен хотя бы один участник с опубликованным ключом шифрования")
                    const expected = new Set(withPub.map((r) => r.user_id))
                    const got = new Set(parsed.map((p) => p.targetUserId))
                    if (expected.size !== got.size) throw new RoomKeyRequestError("Нужны обёртки для всех участников с ключом")
                    for (const id of expected) {
                        if (!got.has(id)) throw new RoomKeyRequestError("Нужны обёртки для всех участников с ключом")
                    }
                    for (const { targetUserId } of parsed) {
                        if (!expected.has(targetUserId)) throw new RoomKeyRequestError("Обёртка не для того участника")
                    }
                }

                const maxMidRes = await client.query<{ mid: number }>(
                    "SELECT COALESCE(MAX(id), 0)::int AS mid FROM messages WHERE room_id = $1",
                    [roomId]
                )
                const visibleAfter = maxMidRes.rows[0]?.mid ?? 0

                for (const { targetUserId, cipher } of parsed) {
                    await client.query(
                        `INSERT INTO room_e2ee_wraps (room_id, user_id, wrapper_user_id, ciphertext, e2ee_visible_after_id, wrapper_public_key)
                         SELECT $1, $2, $3, $4, CASE WHEN $6::int = 0 THEN $5::int ELSE m.visible_after_id END, u.dm_public_key
                         FROM users u JOIN room_members m ON m.room_id=$1 AND m.user_id=$2
                         WHERE u.id = $3 AND u.dm_public_key IS NOT NULL`,
                        [roomId, targetUserId, uid, cipher, visibleAfter, epoch]
                    )
                }
                await client.query("COMMIT")
            } catch (e) {
                await client.query("ROLLBACK")
                throw e
            } finally {
                client.release()
            }

            cb({ success: true })
        } catch (err) {
            if (err instanceof RoomKeyRequestError) return cb({ err: err.message })
            console.error("room:e2eePutWraps", err)
            cb({ err: "Ошибка" })
        }
    })
}
