import { createHash } from "node:crypto"
import type { PoolClient } from "pg"
import { applyRuntimePrivilegesInTransaction, type RuntimeRoleNames } from "./localRoles"
import { readPendingMigrations, recordMigration, type PendingMigration } from "./migrationPlan"

const reviewedExpansions: ReadonlyMap<string, string> = new Map([
    ["036_auth_session_notifications.sql", "6e34a9bada37839c679755377afcbbd707c076326e98fb09d0563ca9fb8ea193"],
    ["037_media_quota_usage.sql", "b07f971cf7baaf0f3efa7e52ff844979046dfcff62f7865ce234945d1d7d1bcf"]
])

function verifyRollingMigrations(migrations: PendingMigration[]): void {
    const unreviewed = migrations.filter(
        ({ file, sql }) => reviewedExpansions.get(file) !== createHash("sha256").update(sql).digest("hex")
    )
    if (unreviewed.length > 0) {
        const names = unreviewed.map(({ file }) => file).join(", ")
        throw new Error(`Rolling deployment blocked by unreviewed migrations: ${names}`)
    }
}

export async function applyRollingMigrations(
    client: PoolClient,
    directory: string,
    roles: RuntimeRoleNames
): Promise<void> {
    await client.query("BEGIN")
    let migrations: PendingMigration[]
    try {
        await client.query("SET LOCAL lock_timeout = '500ms'")
        await client.query("SET LOCAL statement_timeout = '5s'")
        migrations = await readPendingMigrations(client, directory)
        verifyRollingMigrations(migrations)
        for (const migration of migrations) await recordMigration(client, migration)
        await applyRuntimePrivilegesInTransaction(client, roles, "expand")
        await client.query("COMMIT")
    } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined)
        throw error
    }
    for (const { file } of migrations) console.log("Migration applied:", file)
}
