import "dotenv/config"
import { pool, redis } from "../shared/config"
async function grantRuntimePrivileges() {
    const identity = (await pool.query("SELECT current_user AS role,current_database() AS db")).rows[0]
    if (identity.role !== "playtime_migrator" || identity.db !== "playtime")
        throw new Error("Use the PlayTime migration role and database")
    await pool.query("GRANT USAGE ON SCHEMA public TO playtime_runtime")
    await pool.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO playtime_runtime")
    await pool.query("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO playtime_runtime")
    await pool.query("REVOKE INSERT, UPDATE, DELETE ON schema_migrations FROM playtime_runtime")
    await pool.query(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO playtime_runtime"
    )
    await pool.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO playtime_runtime")
    console.log("Runtime DML privileges updated; schema changes remain restricted to migrator.")
}

export async function runRuntimeGrantCli(): Promise<void> {
    try {
        await grantRuntimePrivileges()
    } catch (error) {
        console.error(error instanceof Error ? error.message : error)
        process.exitCode = 1
    } finally {
        await pool.end()
        await redis.quit()
    }
}

if (require.main === module) void runRuntimeGrantCli()
