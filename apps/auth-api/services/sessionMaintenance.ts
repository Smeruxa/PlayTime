import type { FeatureIo } from "../../shared/socket/featureContext"
import { pool } from "../../shared/config"
import { setGuestArchiveListener } from "../auth/guestLifecycle"
import { cleanupExpiredSessions, migrateLegacySessions } from "../auth/migrateLegacySessions"

export async function startSessionMaintenance(io: FeatureIo): Promise<() => void> {
    setGuestArchiveListener(async (userId) => {
        try {
            const account = await pool.query<{ username: string }>(
                "SELECT guest_original_username AS username FROM users WHERE id=$1 AND guest_archived_at IS NOT NULL",
                [userId]
            )
            const username = account.rows[0]?.username
            if (!username) return
            const friends = await pool.query<{ id: number }>(
                "SELECT CASE WHEN user_id=$1 THEN friend_id ELSE user_id END AS id FROM friendships WHERE user_id=$1 OR friend_id=$1",
                [userId]
            )
            for (const peer of friends.rows) {
                io.to(String(peer.id)).emit("friend:list:updated")
                io.to(String(peer.id)).emit("profile:updated", { userId, username, archived: true })
                io.to(String(peer.id)).emit("presence:changed", { userId, peerUserId: userId, username, online: false })
            }
        } catch (error) {
            console.error("guest archive notification", error)
        } finally {
            io.in(String(userId)).disconnectSockets(true)
        }
    })
    await migrateLegacySessions()
    await cleanupExpiredSessions()
    const cleanup = setInterval(
        () => {
            void cleanupExpiredSessions().catch((error) => console.error("session cleanup", error))
        },
        60 * 60 * 1000
    )
    cleanup.unref()
    return () => {
        clearInterval(cleanup)
        setGuestArchiveListener(undefined)
    }
}
