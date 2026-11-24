import type { PoolClient } from "pg"
import { pool } from "../../shared/deps"

const FRIENDSHIP_LOCK = 1919247490
export const FRIEND_REQUEST_LIMIT = 50
export const PEER_UNAVAILABLE = "Пользователь не найден"

export async function lockFriendship(client: Pick<PoolClient, "query">, a: number, b: number): Promise<void> {
    for (const id of [Math.min(a, b), Math.max(a, b)]) {
        await client.query("SELECT pg_advisory_xact_lock($1, $2)", [FRIENDSHIP_LOCK, id])
    }
}

async function insertRequest(
    client: PoolClient,
    userId: number,
    { id: friendId, username }: { id: number; username: string }
): Promise<string | null> {
    await lockFriendship(client, userId, friendId)
    const blocked = await client.query(
        `SELECT 1 FROM friendships
         WHERE ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND status='blocked'
         UNION ALL
         SELECT 1 FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)`,
        [userId, friendId]
    )
    if (blocked.rows.length) return PEER_UNAVAILABLE

    const existing = await client.query<{ user_id: number; status: string }>(
        `SELECT user_id, status FROM friendships
         WHERE ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND status IN ('pending', 'accepted')`,
        [userId, friendId]
    )
    if (existing.rows.some(({ status }) => status === "accepted")) return "Вы уже друзья"
    if (existing.rows.length) {
        return existing.rows[0].user_id === userId
            ? `Вы уже отправили запрос в друзья ${username}`
            : `${username} уже отправил вам запрос в друзья`
    }

    const full = await client.query(
        "SELECT 1 FROM friendships WHERE user_id=$1 AND status='pending' OFFSET $2 LIMIT 1",
        [userId, FRIEND_REQUEST_LIMIT - 1]
    )
    if (full.rows.length) return "Достигнут лимит исходящих запросов в друзья"

    const inserted = await client.query(
        "INSERT INTO friendships (user_id, friend_id, status, created_at) VALUES ($1, $2, 'pending', NOW()) ON CONFLICT DO NOTHING",
        [userId, friendId]
    )
    return inserted.rowCount ? null : PEER_UNAVAILABLE
}

export async function createFriendRequest(
    userId: number,
    peer: { id: number; username: string }
): Promise<string | null> {
    const client = await pool.connect()
    try {
        await client.query("BEGIN")
        const result = await insertRequest(client, userId, peer)
        await client.query("COMMIT")
        return result
    } catch (error) {
        await client.query("ROLLBACK")
        throw error
    } finally {
        client.release()
    }
}
