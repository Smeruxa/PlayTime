import { resolvePeer, emitPeerEvent } from "../peerIdentity"
import type { FeatureContext } from "../../../shared/socket/featureContext"
import { pool, parsePositiveInt, normalizeUsername } from "./helpers"

const THROTTLE_MS = 2500
const lastTrueEmit = new Map<string, number>()

function throttleKey(userId: number, roomId: number | null, dmKey: string | null): string {
    if (roomId != null) return `r:${userId}:${roomId}`
    return `d:${userId}:${dmKey ?? ""}`
}

export interface ChatTypingPayload {
    roomId?: unknown
    peerUserId?: unknown
    dmUsername?: unknown
    typing?: unknown
}

export default function registerChatTyping({ io, socket, user }: FeatureContext): void {
    const uid = user.id
    const uname = user.username

    socket.on("chat:typing", async (data: ChatTypingPayload) => {
        try {
            const typing = data?.typing === true
            if (data.roomId != null) {
                const roomId = parsePositiveInt(data.roomId)
                if (!roomId) return
                const member = await pool.query("SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2", [
                    roomId,
                    uid
                ])
                if (member.rows.length === 0) return

                if (typing) {
                    const k = throttleKey(uid, roomId, null)
                    const now = Date.now()
                    const prev = lastTrueEmit.get(k) ?? 0
                    if (now - prev < THROTTLE_MS) return
                    lastTrueEmit.set(k, now)
                }

                const members = await pool.query<{ user_id: number }>(
                    "SELECT user_id FROM room_members WHERE room_id=$1",
                    [roomId]
                )
                const evt = { fromUsername: uname, roomId, typing }
                members.rows.forEach((m) => {
                    if (m.user_id !== uid) io.to(m.user_id.toString()).emit("chat:typing", evt)
                })
                return
            }

            let dmUsername = normalizeUsername(data.dmUsername)
            if (!dmUsername && data.peerUserId === undefined) return
            const peer = await resolvePeer(data.peerUserId, dmUsername, {})
            if (!peer) return
            const peerId = peer.id
            dmUsername = peer.username

            const friend = await pool.query(
                "SELECT 1 FROM friendships WHERE ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND status='accepted'",
                [uid, peerId]
            )
            if (friend.rows.length === 0) return

            if (typing) {
                const k = throttleKey(uid, null, dmUsername)
                const now = Date.now()
                const prev = lastTrueEmit.get(k) ?? 0
                if (now - prev < THROTTLE_MS) return
                lastTrueEmit.set(k, now)
            }

            const evt = { fromUsername: uname, fromUserId: uid, peerUserId: uid, dmPeer: dmUsername, typing }
            await emitPeerEvent(io, peerId, [uid, peerId], "chat:typing", evt)
        } catch (e) {
            console.error("chat:typing", e)
        }
    })
}
