import type { Pool, PoolClient } from "pg"

export async function withMigrationLock<T>(
    pool: Pick<Pool, "connect">,
    run: (client: PoolClient) => Promise<T>
): Promise<T> {
    const client = await pool.connect()
    try {
        await client.query("SELECT pg_catalog.pg_advisory_lock($1, $2)", [1903435348, 1])
        return await run(client)
    } finally {
        client.release(true)
    }
}
