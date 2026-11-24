import { pool } from "../../shared/config"
import { getLatestPublishedMap } from "../releases/releaseService"

export type AdminStats = {
    usersTotal: number
    adminsTotal: number
    blockedTotal: number
    usersByPlan: { plan: string; count: number }[]
    releasesTotal: number
    releasesPublished: number
    latestDownloads: Partial<
        Record<
            "darwin" | "win32",
            { version: string; url: string; fileSize: number; publishedAt: string | null }
        >
    >
}

export async function getAdminStats(): Promise<AdminStats> {
    const [usersR, adminsR, blockedR, plansR, releasesR, publishedR, latest] = await Promise.all([
        pool.query<{ c: number }>("SELECT COUNT(*)::int AS c FROM users"),
        pool.query<{ c: number }>("SELECT COUNT(*)::int AS c FROM users WHERE is_admin = TRUE"),
        pool.query<{ c: number }>("SELECT COUNT(*)::int AS c FROM users WHERE is_blocked = TRUE"),
        pool.query<{ plan: string; count: number }>(
            `SELECT COALESCE(s.plan_slug, 'free') AS plan, COUNT(*)::int AS count
             FROM users u
             LEFT JOIN user_subscriptions s ON s.user_id = u.id
             GROUP BY 1
             ORDER BY count DESC`
        ),
        pool.query<{ c: number }>("SELECT COUNT(*)::int AS c FROM app_releases"),
        pool.query<{ c: number }>("SELECT COUNT(*)::int AS c FROM app_releases WHERE is_published = TRUE"),
        getLatestPublishedMap()
    ])

    const latestDownloads: AdminStats["latestDownloads"] = {}
    for (const platform of ["darwin", "win32"] as const) {
        const row = latest[platform]
        if (row) {
            latestDownloads[platform] = {
                version: row.version,
                url: row.url,
                fileSize: row.fileSize,
                publishedAt: row.publishedAt
            }
        }
    }

    return {
        usersTotal: usersR.rows[0]?.c ?? 0,
        adminsTotal: adminsR.rows[0]?.c ?? 0,
        blockedTotal: blockedR.rows[0]?.c ?? 0,
        usersByPlan: plansR.rows,
        releasesTotal: releasesR.rows[0]?.c ?? 0,
        releasesPublished: publishedR.rows[0]?.c ?? 0,
        latestDownloads
    }
}
