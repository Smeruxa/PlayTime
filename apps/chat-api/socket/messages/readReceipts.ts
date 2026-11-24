import { resolvePeer } from "../peerIdentity"
import type { FeatureContext } from "../../../shared/socket/featureContext"
import { pool, parsePositiveInt, normalizeUsername, markDmInboundReadAndNotify, bumpRoomRead } from "./helpers"

export interface MessageMarkReadPayload {
    peerUserId?: unknown
    username?: unknown
}

export interface MessageMarkRoomReadPayload {
    roomId?: unknown
}

export default function registerMessageReadReceipts({ io, socket, user }: FeatureContext): void {
    const uid = user.id
    const uname = user.username

    socket.on("message:markRead", async (data: MessageMarkReadPayload) => {
        try {
            let dmUsername = normalizeUsername(data?.username)
            if (!dmUsername && data.peerUserId === undefined) return
            const peer = await resolvePeer(data.peerUserId, dmUsername, { allowArchived: true })
            if (!peer) return
            const peerId = peer.id
            dmUsername = peer.username
            const friend = await pool.query(
                "SELECT 1 FROM friendships WHERE ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND status='accepted'",
                [uid, peerId]
            )
            if (friend.rows.length === 0) return
            await markDmInboundReadAndNotify(io, uid, uname, peerId)
        } catch (e) {
            console.error("message:markRead", e)
        }
    })

    socket.on("message:markRoomRead", async (data: MessageMarkRoomReadPayload) => {
        try {
            const roomId = parsePositiveInt(data?.roomId)
            if (!roomId) return
            const member = await pool.query("SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2", [
                roomId,
                uid
            ])
            if (member.rows.length === 0) return
            await bumpRoomRead(uid, roomId)
        } catch (e) {
            console.error("message:markRoomRead", e)
        }
    })
}
