import { resolvePeer, emitPeerEvent } from "../peerIdentity"
import { canSeeRoomMessage, roomMessageRecipients } from "./visibility"
import type { FeatureContext, FeatureIo } from "../../../shared/socket/featureContext"
import { pool, parsePositiveInt, normalizeUsername } from "./helpers"

type SetPinPayload = {
    roomId?: unknown
    messageId?: unknown
}

type DmSetPinPayload = {
    peerUserId?: unknown
    dmUsername?: unknown
    messageId?: unknown
}

export default function registerRoomPin({ io, socket, user }: FeatureContext): void {
    const uid = user.id
    const uname = user.username

    socket.on("room:setPin", async (data: SetPinPayload) => {
        try {
            const roomId = parsePositiveInt(data?.roomId)
            if (!roomId) return
            const member = await pool.query("SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2", [
                roomId,
                uid
            ])
            if (member.rows.length === 0) return

            const rawMid = data?.messageId
            if (rawMid == null) {
                await pool.query("UPDATE rooms SET pinned_message_id = NULL WHERE id = $1", [roomId])
                await emitPin(io, roomId, null)
                return
            }
            const messageId = parsePositiveInt(rawMid)
            if (!messageId || !(await canSeeRoomMessage(uid, roomId, messageId))) return
            const ok = await pool.query("SELECT 1 FROM messages WHERE id = $1 AND room_id = $2", [messageId, roomId])
            if (ok.rows.length === 0) return
            await pool.query("UPDATE rooms SET pinned_message_id = $1 WHERE id = $2", [messageId, roomId])
            await emitPin(io, roomId, messageId)
        } catch (e) {
            console.error("room:setPin", e)
        }
    })

    socket.on("dm:setPin", async (data: DmSetPinPayload) => {
        try {
            let dmU = normalizeUsername(data?.dmUsername)
            if (!dmU && data.peerUserId === undefined) return
            const peer = await resolvePeer(data.peerUserId, dmU, {})
            if (!peer) return
            const peerId = peer.id
            dmU = peer.username
            if (peerId === uid) return

            const friend = await pool.query(
                "SELECT 1 FROM friendships WHERE ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND status='accepted'",
                [uid, peerId]
            )
            if (friend.rows.length === 0) return

            const low = uid < peerId ? uid : peerId
            const high = uid < peerId ? peerId : uid

            const rawMid = data?.messageId
            if (rawMid == null) {
                await pool.query(
                    "UPDATE dm_pinned_messages SET pinned_message_id = NULL, updated_at = NOW() WHERE user_a_id = $1 AND user_b_id = $2",
                    [low, high]
                )
                await emitPeerEvent(io, uid, [uid, peerId], "dm:pinChanged", {
                    dmPeer: dmU,
                    peerUserId: peerId,
                    messageId: null
                })
                await emitPeerEvent(io, peerId, [uid, peerId], "dm:pinChanged", {
                    dmPeer: uname,
                    peerUserId: uid,
                    messageId: null
                })
                return
            }

            const messageId = parsePositiveInt(rawMid)
            if (!messageId) return
            const ok = await pool.query(
                `SELECT 1 FROM messages
                 WHERE id = $1 AND room_id IS NULL
                   AND ((sender_id = $2 AND receiver_id = $3) OR (sender_id = $3 AND receiver_id = $2))`,
                [messageId, uid, peerId]
            )
            if (ok.rows.length === 0) return

            await pool.query(
                `INSERT INTO dm_pinned_messages (user_a_id, user_b_id, pinned_message_id, updated_at)
                 VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET pinned_message_id = EXCLUDED.pinned_message_id, updated_at = NOW()`,
                [low, high, messageId]
            )
            await emitPeerEvent(io, uid, [uid, peerId], "dm:pinChanged", { dmPeer: dmU, peerUserId: peerId, messageId })
            await emitPeerEvent(io, peerId, [uid, peerId], "dm:pinChanged", {
                dmPeer: uname,
                peerUserId: uid,
                messageId
            })
        } catch (e) {
            console.error("dm:setPin", e)
        }
    })
}

async function emitPin(io: Pick<FeatureIo, "to">, roomId: number, messageId: number | null): Promise<void> {
    const recipients = messageId
        ? { rows: await roomMessageRecipients(roomId, messageId) }
        : await pool.query<{ user_id: number }>("SELECT user_id FROM room_members WHERE room_id = $1", [roomId])
    for (const r of recipients.rows) {
        io.to(r.user_id.toString()).emit("room:pinChanged", { roomId, messageId })
    }
}
