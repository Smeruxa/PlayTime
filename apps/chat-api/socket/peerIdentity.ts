import type { PoolClient } from "pg"
import { pool } from "../../shared/deps"
import type { FeatureIo } from "../../shared/socket/featureContext"
import { peerIdentityUserRoom } from "../../shared/socket/peerAudience"

export { peerIdentityUserRoom } from "../../shared/socket/peerAudience"

export interface PeerIdentity {
    id: number
    username: string
    guest_archived_at: Date | null
}

export async function resolvePeer(
    peerUserId: unknown,
    username: unknown,
    options: { allowArchived?: boolean; db?: Pick<PoolClient, "query"> } = {}
): Promise<PeerIdentity | null> {
    const db = options.db ?? pool
    let result
    if (peerUserId !== undefined) {
        if (typeof peerUserId !== "number" || !Number.isSafeInteger(peerUserId) || peerUserId <= 0) return null
        result = await db.query<PeerIdentity>(
            "SELECT id, COALESCE(guest_original_username, username) AS username, guest_archived_at FROM users WHERE id = $1",
            [peerUserId]
        )
    } else {
        if (typeof username !== "string" || !username.trim() || username.length > 50) return null
        result = await db.query<PeerIdentity>(
            `SELECT id, username, guest_archived_at FROM users
             WHERE username = $1 AND guest_archived_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM username_reclaims WHERE username = $1)`,
            [username.trim()]
        )
    }
    const peer = result.rows[0]
    if (!peer || (peer.guest_archived_at && !options.allowArchived)) return null
    return peer
}

export async function peerEventRoom(
    recipientId: number,
    participantIds: number[],
    db: Pick<PoolClient, "query"> = pool
): Promise<string> {
    const reclaimed = await db.query(
        `SELECT 1 FROM users u WHERE u.id = ANY($1::int[])
         AND (u.is_guest = TRUE OR u.guest_archived_at IS NOT NULL OR EXISTS (
             SELECT 1 FROM username_reclaims nr
             WHERE nr.username = COALESCE(u.guest_original_username, u.username)
         )) LIMIT 1`,
        [participantIds]
    )
    return reclaimed.rows.length ? peerIdentityUserRoom(recipientId) : String(recipientId)
}

export async function emitPeerEvent(
    io: Pick<FeatureIo, "to">,
    recipientId: number,
    participantIds: number[],
    event: string,
    payload: unknown,
    db: Pick<PoolClient, "query"> = pool
): Promise<void> {
    io.to(await peerEventRoom(recipientId, participantIds, db)).emit(event, payload)
}
