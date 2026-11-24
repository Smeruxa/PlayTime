import { enqueuePush } from "../../database/pushOutbox"
import { pool } from "../../shared/deps"
import { getLimitsForUser } from "../subscription/subscriptionService"
import { peerEventRoom, resolvePeer } from "../../chat-api/socket/peerIdentity"
import { logDirectCallDuration } from "./callLog"
import type { DirectCallServices } from "../../room-api/socket/directCall/index"

export const localDirectCallServices: DirectCallServices = {
    resolvePeer,
    peerEventRoom,
    users: async (ids) =>
        (await pool.query<{ id: number; username: string }>(
            "SELECT id, COALESCE(guest_original_username, username) AS username FROM users WHERE id = ANY($1::int[])",
            [ids]
        )).rows,
    canCall: async (userId, peerId) =>
        (await pool.query(
            "SELECT 1 FROM friendships WHERE ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND status='accepted' AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1))",
            [userId, peerId]
        )).rows.length > 0,
    screenFps: async (userId) => (await getLimitsForUser(userId)).limits.maxScreenBroadcastFps,
    enqueueIncomingCall: ({ roomId, senderId, senderUsername, recipientId, expiresAt }) =>
        enqueuePush({
            eventKey: `c:${roomId}`,
            chatKey: `dm:${senderUsername}`,
            senderId,
            recipients: [recipientId],
            callRoomId: roomId,
            target: { version: 1, userId: recipientId, kind: "call" },
            title: senderUsername,
            expiresAt
        }),
    logEnded: logDirectCallDuration
}
