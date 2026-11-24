import { resolvePeer, emitPeerEvent } from "./peerIdentity"
import type { FeatureContext } from "../../shared/socket/featureContext"
import { pool } from "../../shared/deps"
import { socketAck } from "../../shared/types/socket/ack"
import type { RowFriendListRow, RowRoomSidebar, RowUserIdUsername } from "../../shared/types/db"
import { blockPeer, type PeerBlockEffects } from "../services/peerBlock"
import { createFriendRequest, PEER_UNAVAILABLE } from "../services/friendRequests"

export interface FriendUsernamePayload {
    peerUserId?: unknown
    friendUsername?: string
}

interface FriendListFriendEntry extends RowFriendListRow {
    is_room: false
    other_user_id: number
    friend_archived?: boolean
}

interface FriendListRoomEntry {
    id: number
    user_id: number
    friend_id: null
    status: "accepted"
    friendship_created: Date
    friend_username: string
    direction: "outgoing"
    last_message: null
    last_message_at: null
    is_room: true
}

type FriendListPayload = FriendListFriendEntry | FriendListRoomEntry

export default function registerFriendship({ io, socket, user }: FeatureContext, effects: PeerBlockEffects): void {
    const uid = user.id
    const uname = user.username
    const { friendsChanged } = effects

    socket.on("friend:request", async (data: FriendUsernamePayload) => {
        try {
            const peer =
                data.peerUserId !== undefined
                    ? await resolvePeer(data.peerUserId, data.friendUsername)
                    : (
                          await pool.query<RowUserIdUsername>(
                              "SELECT id, username FROM users WHERE username=$1 AND guest_archived_at IS NULL",
                              [data.friendUsername]
                          )
                      ).rows[0]
            if (!peer) return socket.emit("friend:request:error", { err: PEER_UNAVAILABLE })
            const friendId = peer.id
            if (friendId === uid) return socket.emit("friend:request:error", { err: "Вы не можете добавить самого себя" })
            const error = await createFriendRequest(uid, peer)
            if (error) return socket.emit("friend:request:error", { err: error })

            socket.emit("friend:request:success", { msg: "Запрос успешно отправлен", username: data.friendUsername })
            await emitPeerEvent(io, friendId, [uid, friendId], "friend:request", {
                id: uid,
                user_id: uid,
                friend_id: friendId,
                status: "pending",
                friend_username: uname
            })
        } catch (err) {
            console.error("friend:request error", err)
        }
    })

    socket.on("friend:accept", async (data: FriendUsernamePayload) => {
        try {
            const peer = await resolvePeer(data.peerUserId, data.friendUsername)
            if (!peer) return
            const friendId = peer.id
            const accepted = await pool.query(
                "UPDATE friendships SET status='accepted' WHERE user_id=$1 AND friend_id=$2 AND status='pending' AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)) RETURNING id",
                [friendId, uid]
            )
            if (!accepted.rows.length) return

            friendsChanged(uid, friendId)
            socket.emit("friend:list:updated")
            await emitPeerEvent(io, friendId, [uid, friendId], "friend:accept", { from: user })
            io.to(friendId.toString()).emit("friend:list:updated")
        } catch (err) {
            console.error("friend:accept error", err)
        }
    })

    socket.on("friend:decline", async (data: FriendUsernamePayload) => {
        try {
            const peer = await resolvePeer(data.peerUserId, data.friendUsername, { allowArchived: true })
            if (!peer) return
            const friendId = peer.id
            await pool.query(
                "DELETE FROM friendships WHERE ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND status='pending'",
                [friendId, uid]
            )

            friendsChanged(uid, friendId)
            await emitPeerEvent(io, friendId, [uid, friendId], "friend:decline", { from: user })
            io.to([String(uid), String(friendId)]).emit("friend:list:updated")
        } catch (err) {
            console.error("friend:decline error", err)
        }
    })

    socket.on("friend:remove", async (data: FriendUsernamePayload) => {
        try {
            const peer = await resolvePeer(data.peerUserId, data.friendUsername, { allowArchived: true })
            if (!peer) return
            const friendId = peer.id
            await pool.query(
                "DELETE FROM friendships WHERE ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND status='accepted'",
                [uid, friendId]
            )

            friendsChanged(uid, friendId)
            await emitPeerEvent(io, uid, [uid, friendId], "presence:changed", {
                username: peer.username,
                peerUserId: friendId,
                userId: friendId,
                online: false
            })
            await emitPeerEvent(io, friendId, [uid, friendId], "presence:changed", {
                username: uname,
                peerUserId: uid,
                userId: uid,
                online: false
            })
            await emitPeerEvent(io, friendId, [uid, friendId], "friend:remove", { from: uname, fromUserId: uid })
            io.to([String(uid), String(friendId)]).emit("friend:list:updated")
        } catch (err) {
            console.error("friend:remove error", err)
        }
    })

    socket.on("friend:block", async (data: FriendUsernamePayload) => {
        try {
            const peer = await resolvePeer(data.peerUserId, data.friendUsername, { allowArchived: true })
            if (!peer) return
            const friendId = peer.id
            if (friendId === uid) return
            await blockPeer(io, user, { id: friendId, username: peer.username }, effects)
        } catch (err) {
            console.error("friend:block error", err)
        }
    })

    socket.on("friend:outgoingIdentities", async (_: unknown, callback: unknown) => {
        const ack = socketAck<{ userId: number; username: string; archived: boolean }[]>(callback)
        try {
            const result = await pool.query<{ userId: number; username: string; archived: boolean }>(
                `SELECT u.id AS "userId", COALESCE(u.guest_original_username, u.username) AS username,
                        (u.guest_archived_at IS NOT NULL) AS archived
                 FROM friendships f JOIN users u ON u.id = f.friend_id
                 WHERE f.user_id = $1 AND f.status = 'pending'`,
                [uid]
            )
            ack?.(result.rows)
        } catch {
            ack?.([])
        }
    })

    socket.on("friend:outgoingList", async (_: unknown, callback: unknown) => {
        const ack = socketAck<string[]>(callback)
        try {
            const result = await pool.query<RowUserIdUsername>(
                `SELECT u.username
                FROM friendships f
                JOIN users u ON u.id = f.friend_id
                WHERE f.user_id=$1 AND f.status='pending'`,
                [uid]
            )

            ack?.(result.rows.map((r) => r.username))
        } catch (err) {
            console.error("friend:outgoingList error", err)
            ack?.([])
        }
    })

    socket.on("friend:list", async (_: unknown, callback: unknown) => {
        const ack = socketAck<FriendListPayload[]>(callback)
        try {
            const friendsRes = await pool.query<RowFriendListRow>(
                `SELECT
                    f.id,
                    f.user_id,
                    f.friend_id,
                    f.status,
                    f.created_at AS friendship_created,
                    COALESCE(u.guest_original_username, u.username) AS friend_username,
                    (u.guest_archived_at IS NOT NULL) AS friend_archived,
                    CASE
                        WHEN f.user_id=$1 THEN 'outgoing'
                        ELSE 'incoming'
                    END AS direction,
                    m.content AS last_message,
                    m.created_at AS last_message_at
                FROM friendships f
                JOIN users u
                    ON u.id = CASE WHEN f.user_id=$1 THEN f.friend_id ELSE f.user_id END
                LEFT JOIN LATERAL (
                    SELECT content, created_at
                    FROM messages
                    WHERE (sender_id = $1 AND receiver_id = u.id) OR (sender_id = u.id AND receiver_id = $1)
                    ORDER BY created_at DESC
                    LIMIT 1
                ) m ON true
                WHERE f.user_id=$1 OR f.friend_id=$1
                ORDER BY m.created_at DESC NULLS LAST, f.created_at DESC`,
                [uid]
            )

            const roomsRes = await pool.query<RowRoomSidebar>(
                `SELECT r.id, r.name
                FROM rooms r
                JOIN room_members rm ON rm.room_id = r.id
                WHERE rm.user_id=$1
                ORDER BY r.created_at DESC`,
                [uid]
            )

            const rooms: FriendListRoomEntry[] = roomsRes.rows.map((r) => ({
                id: r.id,
                user_id: uid,
                friend_id: null,
                status: "accepted",
                friendship_created: new Date(),
                friend_username: r.name ?? `Комната №${r.id}`,
                direction: "outgoing",
                last_message: null,
                last_message_at: null,
                is_room: true
            }))

            const friends: FriendListFriendEntry[] = friendsRes.rows.map((f) => ({
                ...f,
                is_room: false,
                other_user_id: f.user_id === uid ? f.friend_id : f.user_id
            }))

            ack?.([...friends, ...rooms])
        } catch (err) {
            console.error("friend:list error", err)
            ack?.([])
        }
    })
}
