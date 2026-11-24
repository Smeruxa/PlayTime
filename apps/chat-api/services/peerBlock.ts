import { emitPeerEvent } from "../socket/peerIdentity"
import type { RoomBlockPeersCommand } from "../../shared/runtime/roomContracts"
import type { FeatureIo } from "../../shared/socket/featureContext"
import { pool } from "../../shared/deps"
import { lockFriendship } from "./friendRequests"

export interface PeerBlockEffects {
    friendsChanged: (userId: number, peerId: number) => void
    endCall: (command: RoomBlockPeersCommand) => Promise<void>
}

export async function arePeersBlocked(userId: number, peerId: number): Promise<boolean> {
    const result = await pool.query(
        "SELECT 1 FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)",
        [userId, peerId]
    )
    return result.rows.length > 0
}

export async function blockPeer(
    io: Pick<FeatureIo, "to"> | undefined,
    user: { id: number; username: string },
    peer: { id: number; username: string },
    effects: PeerBlockEffects
): Promise<void> {
    const client = await pool.connect()
    try {
        await client.query("BEGIN")
        await lockFriendship(client, user.id, peer.id)
        await client.query("INSERT INTO user_blocks(blocker_id,blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [
            user.id,
            peer.id
        ])
        await client.query(
            "DELETE FROM friendships WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)",
            [user.id, peer.id]
        )
        await client.query("COMMIT")
    } catch (error) {
        await client.query("ROLLBACK")
        throw error
    } finally {
        client.release()
    }

    try {
        effects.friendsChanged(user.id, peer.id)
        if (!io) return
        const participants = [user.id, peer.id]
        await emitPeerEvent(io, user.id, participants, "presence:changed", {
            username: peer.username,
            userId: peer.id,
            peerUserId: peer.id,
            online: false
        })
        await emitPeerEvent(io, peer.id, participants, "presence:changed", {
            username: user.username,
            userId: user.id,
            peerUserId: user.id,
            online: false
        })
        io.to(String(user.id)).emit("friend:list:updated")
        await emitPeerEvent(io, peer.id, participants, "friend:block", {
            from: { id: user.id, username: user.username },
            fromUserId: user.id
        })
        io.to(String(peer.id)).emit("friend:list:updated")
    } finally {
        await effects.endCall({ userId: user.id, peerId: peer.id })
    }
}
