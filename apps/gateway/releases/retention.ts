import fs from "node:fs/promises"
import { pool } from "../../shared/config"
import { platformDir, type AppReleaseRow } from "./releaseService"
import { resolvePathInsideDir } from "../../shared/files/safeFilename"
export function retainedReleaseIds(rows: AppReleaseRow[], now = Date.now()): Set<number> {
    const keep = new Set<number>()
    for (const platform of ["darwin", "win32"]) {
        const platformRows = rows
            .filter((row) => row.platform === platform)
            .sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || b.id - a.id)
        platformRows.filter((row) => row.is_latest).forEach((row) => keep.add(row.id))
        platformRows
            .filter((row) => !row.is_latest)
            .slice(0, 3)
            .forEach((row) => keep.add(row.id))
        platformRows.filter((row) => now - row.created_at.getTime() < 30 * 86400000).forEach((row) => keep.add(row.id))
    }
    return keep
}
export async function pruneOldReleases() {
    const client = await pool.connect()
    let removed = 0
    try {
        await client.query("BEGIN")
        await client.query("SELECT pg_advisory_xact_lock(648923401)")
        const rows = (await client.query<AppReleaseRow>("SELECT * FROM app_releases")).rows,
            keep = retainedReleaseIds(rows)
        const protectedFiles = new Set(
            rows
                .filter((row) => keep.has(row.id))
                .flatMap((row) =>
                    [row.filename, row.update_filename].filter(Boolean).map((name) => row.platform + "/" + name)
                )
        )
        for (const row of rows.filter((row) => !keep.has(row.id))) {
            for (const name of new Set([row.filename, row.update_filename].filter((name): name is string => !!name))) {
                if (protectedFiles.has(row.platform + "/" + name)) continue
                const file = resolvePathInsideDir(platformDir(row.platform), name)
                if (!file) throw new Error("Invalid stored release path")
                await fs.unlink(file).catch((error: Error & { code?: string }) => {
                    if (error.code !== "ENOENT") throw error
                })
            }
            await client.query("DELETE FROM app_releases WHERE id=$1 AND is_latest=FALSE", [row.id])
            removed++
        }
        await client.query("COMMIT")
        return removed
    } catch (error) {
        await client.query("ROLLBACK")
        throw error
    } finally {
        client.release()
    }
}
