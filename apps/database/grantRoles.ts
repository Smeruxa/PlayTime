import "dotenv/config"
import { pool, redis } from "../shared/config"
import { configuredRuntimeRoleNames, grantLocalRuntimePrivileges } from "./localRoles"
import { withMigrationLock } from "./migrationLock"

void withMigrationLock(pool, (client) => grantLocalRuntimePrivileges(client, configuredRuntimeRoleNames()))
    .catch((error) => {
        console.error("Service database grants failed", error)
        process.exitCode = 1
    })
    .finally(async () => {
        redis.disconnect()
        await pool.end()
    })
