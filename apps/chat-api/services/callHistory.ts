import type { FeatureIo } from "../../shared/socket/featureContext"
import { pool } from "../../shared/deps"
import { emitPeerEvent } from "../socket/peerIdentity"
import type { CallRoomJson } from "../../shared/types/contracts/directCall"

export function formatCallDuration(totalSec: number): string {
    const seconds = Math.max(0, Math.floor(totalSec))
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const remainder = (seconds % 60).toString().padStart(2, "0")
    if (hours > 0) return `${hours}:${minutes.toString().padStart(2, "0")}:${remainder}`
    return `${minutes}:${remainder}`
}

type LoggedCall = Pick<CallRoomJson, "beginer_id" | "receiver_id" | "confirmed_at" | "instance_id">

export async function logDirectCallDuration(
    io: Pick<FeatureIo, "to">,
    room: LoggedCall,
    endedAt = Date.now(),
    roomId?: string
): Promise<void> {
    if (!room.confirmed_at || room.confirmed_at <= 0) return
    const duration = Math.max(1, Math.round((endedAt - room.confirmed_at) / 1000))
    const body = `Звонок · ${formatCallDuration(duration)}`
    const callInstanceKey = room.instance_id ?? (roomId ? `legacy:${roomId}:${room.confirmed_at}` : null)
    const participants = [room.beginer_id, room.receiver_id]
    const users = await pool.query<{ id: number; username: string }>(
        "SELECT id, COALESCE(guest_original_username, username) AS username FROM users WHERE id = ANY($1::int[])",
        [participants]
    )
    const callerName = users.rows.find((user) => user.id === room.beginer_id)?.username
    const receiverName = users.rows.find((user) => user.id === room.receiver_id)?.username
    if (!callerName || !receiverName) return

    const operation = await pool.query<{ id: number; created_at: Date }>(
        `INSERT INTO dm_thread_operations (user_a_id, user_b_id, actor_username, op_kind, body, call_instance_key)
         VALUES ($1, $2, 'PlayTime', 'call', $3, $4)
         ON CONFLICT (call_instance_key) WHERE call_instance_key IS NOT NULL DO NOTHING
         RETURNING id, created_at`,
        [Math.min(...participants), Math.max(...participants), body, callInstanceKey]
    )
    const entry = operation.rows[0]
    if (!entry) return
    const createdAt = entry.created_at instanceof Date ? entry.created_at.toISOString() : String(entry.created_at)
    const op = { id: -entry.id, text: body, created_at: createdAt }
    await emitPeerEvent(io, room.beginer_id, participants, "dmThreadOp:new", {
        peerUsername: receiverName,
        peerUserId: room.receiver_id,
        op
    })
    await emitPeerEvent(io, room.receiver_id, participants, "dmThreadOp:new", {
        peerUsername: callerName,
        peerUserId: room.beginer_id,
        op
    })
}
