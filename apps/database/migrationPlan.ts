import fs from "node:fs"
import path from "node:path"
import type { PoolClient } from "pg"

export type PendingMigration = { file: string; sql: string }

export async function readPendingMigrations(client: PoolClient, directory: string): Promise<PendingMigration[]> {
    const files = fs
        .readdirSync(directory)
        .filter((file) => !file.startsWith(".") && file.endsWith(".sql"))
        .sort()
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version VARCHAR(255) PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `)

    const pending: PendingMigration[] = []
    for (const file of files) {
        const done = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [file])
        if (done.rows.length > 0) continue
        pending.push({ file, sql: fs.readFileSync(path.join(directory, file), "utf8") })
    }
    return pending
}

export async function recordMigration(client: PoolClient, { file, sql }: PendingMigration): Promise<void> {
    await client.query(sql)
    await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file])
}

export async function applyPendingMigrations(client: PoolClient, directory: string): Promise<void> {
    for (const migration of await readPendingMigrations(client, directory)) {
        await client.query("BEGIN")
        try {
            await recordMigration(client, migration)
            await client.query("COMMIT")
            console.log("Migration applied:", migration.file)
        } catch (error) {
            await client.query("ROLLBACK").catch(() => undefined)
            console.error("Migration failed:", migration.file)
            throw error
        }
    }
}
