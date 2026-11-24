import type { PoolClient } from "pg"
import { pool } from "../../../shared/deps"
import type { RowRoomCreatedBy } from "../../../shared/types/db"
import type { RoomErrorAck, RoomSuccessAck } from "../../../shared/types/contracts/partyRoom"

export type RoomDatabase = Pick<PoolClient, "query">

export async function lockRoomOwner(db: RoomDatabase, roomId: number): Promise<number | null> {
    const { rows } = await db.query<RowRoomCreatedBy>("SELECT created_by FROM rooms WHERE id = $1 FOR UPDATE", [roomId])
    return rows[0]?.created_by ?? null
}

export async function changeRoom<T extends RoomSuccessAck>(
    change: (client: PoolClient) => Promise<T | RoomErrorAck>
): Promise<T | RoomErrorAck> {
    const client = await pool.connect()
    try {
        await client.query("BEGIN")
        const result = await change(client)
        await client.query("err" in result ? "ROLLBACK" : "COMMIT")
        return result
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {})
        throw error
    } finally {
        client.release()
    }
}
