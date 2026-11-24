import fs from "node:fs"
import path from "node:path"
import { Pool, type PoolClient } from "pg"
import { configuredRuntimeRoleNames, grantLocalRuntimePrivileges } from "./localRoles"
import { withMigrationLock } from "./migrationLock"
import { applyPendingMigrations } from "./migrationPlan"
import { applyRollingMigrations } from "./rollingMigrations"

const baseTables = ["users", "friendships", "rooms", "room_members", "messages"]

async function ensureSchema(client: PoolClient): Promise<boolean> {
    const {
        rows: [{ initialized, empty }]
    } = await client.query<{ initialized: boolean; empty: boolean }>(
        `SELECT (
             SELECT COUNT(*) FROM pg_catalog.pg_class c
             WHERE c.relnamespace = 'public'::pg_catalog.regnamespace
                 AND c.relkind IN ('r', 'p') AND c.relname = ANY($1::name[])
         ) = cardinality($1::name[]) AS initialized,
         NOT EXISTS (
             SELECT 1 FROM pg_catalog.pg_namespace
             WHERE nspname NOT IN ('public', 'information_schema') AND LEFT(nspname, 3) <> 'pg_'
         ) AND NOT EXISTS (
             SELECT 1 FROM pg_catalog.pg_class WHERE relnamespace = 'public'::pg_catalog.regnamespace
         ) AND NOT EXISTS (
             SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace = 'public'::pg_catalog.regnamespace
         ) AND NOT EXISTS (
             SELECT 1 FROM pg_catalog.pg_type WHERE typnamespace = 'public'::pg_catalog.regnamespace
         ) AS empty`,
        [baseTables]
    )
    if (initialized) return false
    if (!empty) throw new Error("PlayTime base schema is incomplete and the database is not empty")
    if (process.env.PLAYTIME_INIT_DATABASE !== "1") {
        throw new Error("Set PLAYTIME_INIT_DATABASE=1 to initialize an empty PlayTime database")
    }

    const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8")
    await client.query("BEGIN")
    try {
        await client.query(schema)
        await client.query("COMMIT")
        return true
    } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined)
        throw error
    }
}

async function main(): Promise<void> {
    const args = process.argv.slice(2)
    const maintenance = args.length === 1 && args[0] === "--maintenance"
    if (args.length > 0 && !maintenance) throw new Error("Expected no arguments or --maintenance")
    const pool = new Pool({
        host: process.env.PG_HOST || "localhost",
        port: Number(process.env.PG_PORT || 5432),
        database: process.env.PG_DATABASE || "playtime",
        user: process.env.PG_USER || "postgres",
        password: process.env.PG_PASSWORD,
        application_name: "playtime-migration",
        connectionTimeoutMillis: 5000,
        lock_timeout: maintenance ? undefined : 500,
        statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 0),
        max: 1
    })
    try {
        await withMigrationLock(pool, async (client) => {
            await client.query("SET search_path = public, pg_temp")
            const initialized = await ensureSchema(client)
            const directory = path.join(__dirname, "migrations")
            const roles = configuredRuntimeRoleNames()
            if (maintenance || initialized) {
                await applyPendingMigrations(client, directory)
                await grantLocalRuntimePrivileges(client, roles)
            } else {
                await applyRollingMigrations(client, directory, roles)
            }
        })
    } finally {
        await pool.end()
    }
}

if (require.main === module) {
    void main().catch((error) => {
        console.error("Cluster database migration failed", error)
        process.exitCode = 1
    })
}
