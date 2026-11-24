import "dotenv/config"
import fs from "fs"
import path from "path"
import { pool, redis } from "../shared/config"
import { withMigrationLock } from "./migrationLock"
import { applyPendingMigrations } from "./migrationPlan"

export async function runPendingMigrations(migrationsDir = path.join(__dirname, "migrations")): Promise<void> {
    if (!fs.existsSync(migrationsDir)) {
        console.warn("runMigrations: no migrations directory")
        return
    }

    await withMigrationLock(pool, (client) => applyPendingMigrations(client, migrationsDir))
}

export async function runMigrationsCli(): Promise<void> {
    try {
        await runPendingMigrations()
    } catch (error) {
        console.error(error)
        process.exitCode = 1
    } finally {
        await pool.end()
        await redis.quit()
    }
}

if (require.main === module) void runMigrationsCli()
