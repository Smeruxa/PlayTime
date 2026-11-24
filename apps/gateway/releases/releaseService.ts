import fs from "node:fs"
import path from "node:path"
import { pool } from "../../shared/config"
import { isSafeFilename, resolvePathInsideDir } from "../../shared/files/safeFilename"

export type ReleasePlatform = "darwin" | "win32"

export type ResolvedPublicDownload = {
    filePath: string
    fileSize: number
    version: string
}

export type AppReleaseRow = {
    id: number
    version: string
    platform: ReleasePlatform
    filename: string
    update_filename: string | null
    file_size: string
    update_file_size: string | null
    sha512: string
    update_sha512: string | null
    is_published: boolean
    is_latest: boolean
    release_notes: string | null
    published_at: Date | null
    created_at: Date
    uploaded_by: number | null
}

export type RegisterReleaseInput = {
    version: string
    platform: ReleasePlatform
    filename: string
    updateFilename?: string | null
    fileSize: number
    updateFileSize?: number | null
    sha512: string
    updateSha512?: string | null
    releaseNotes?: string | null
    uploadedBy?: number | null
}

function releasesRoot(): string {
    const custom = process.env.RELEASES_DIR?.trim()
    if (custom) return path.resolve(custom)
    return path.resolve((process.env.PLAYTIME_BACKEND_ROOT || process.cwd()), "data", "releases")
}

export function getReleasesRoot(): string {
    return releasesRoot()
}

export function platformDir(platform: ReleasePlatform): string {
    return path.join(releasesRoot(), platform)
}

export function getPublicDownloadBase(): string {
    const site = process.env.RELEASE_DOWNLOAD_ORIGIN?.trim() || process.env.SITE_ORIGIN?.trim() || "https://smeruxa.ru"
    return `${site.replace(/\/$/, "")}/playtime/downloads`
}

function rowToPublic(row: AppReleaseRow) {
    const base = getPublicDownloadBase()
    const url = `${base}/${row.platform}/${encodeURIComponent(row.filename)}`
    return {
        id: row.id,
        version: row.version,
        platform: row.platform,
        filename: row.filename,
        url,
        fileSize: Number(row.file_size),
        releaseNotes: row.release_notes,
        publishedAt: row.published_at?.toISOString() ?? null
    }
}

export async function registerRelease(input: RegisterReleaseInput): Promise<AppReleaseRow> {
    if (!isSafeFilename(input.filename) || (input.updateFilename && !isSafeFilename(input.updateFilename))) {
        throw new Error("Invalid release filename")
    }
    const client = await pool.connect()
    try {
        await client.query("BEGIN")
        await client.query("SELECT pg_advisory_xact_lock(648923401)")
        const r = await client.query<AppReleaseRow>(
            `INSERT INTO app_releases (
            version, platform, filename, update_filename,
            file_size, update_file_size, sha512, update_sha512,
            release_notes, uploaded_by, is_published, is_latest
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE, FALSE)
        ON CONFLICT (version, platform) DO UPDATE SET
            filename = EXCLUDED.filename,
            update_filename = EXCLUDED.update_filename,
            file_size = EXCLUDED.file_size,
            update_file_size = EXCLUDED.update_file_size,
            sha512 = EXCLUDED.sha512,
            update_sha512 = EXCLUDED.update_sha512,
            release_notes = COALESCE(EXCLUDED.release_notes, app_releases.release_notes),
            uploaded_by = EXCLUDED.uploaded_by
        RETURNING *`,
            [
                input.version,
                input.platform,
                input.filename,
                input.updateFilename ?? null,
                input.fileSize,
                input.updateFileSize ?? null,
                input.sha512,
                input.updateSha512 ?? null,
                input.releaseNotes ?? null,
                input.uploadedBy ?? null
            ]
        )
        await client.query("COMMIT")
        return r.rows[0]
    } catch (error) {
        await client.query("ROLLBACK")
        throw error
    } finally {
        client.release()
    }
}

export async function listReleases(): Promise<AppReleaseRow[]> {
    const r = await pool.query<AppReleaseRow>(`SELECT * FROM app_releases ORDER BY created_at DESC, id DESC`)
    return r.rows
}

export async function getReleaseById(id: number): Promise<AppReleaseRow | null> {
    const r = await pool.query<AppReleaseRow>(`SELECT * FROM app_releases WHERE id = $1`, [id])
    return r.rows[0] ?? null
}

export async function getLatestPublished(platform: ReleasePlatform): Promise<AppReleaseRow | null> {
    const r = await pool.query<AppReleaseRow>(
        `SELECT * FROM app_releases
         WHERE platform = $1 AND is_published = TRUE AND is_latest = TRUE
         ORDER BY published_at DESC NULLS LAST, id DESC
         LIMIT 1`,
        [platform]
    )
    return r.rows[0] ?? null
}

export function isLatestPublicArtifact(row: AppReleaseRow, filename: string): boolean {
    if (filename === row.filename) return true
    if (row.update_filename && filename === row.update_filename) return true
    return false
}

export async function resolveLatestPublicDownload(
    platform: ReleasePlatform,
    filename: string
): Promise<ResolvedPublicDownload | null> {
    if (!isSafeFilename(filename)) return null
    const row = await getLatestPublished(platform)
    if (!row || !isLatestPublicArtifact(row, filename)) return null
    const filePath = resolvePathInsideDir(platformDir(platform), filename)
    if (!filePath || !fs.existsSync(filePath)) return null
    let fileSize = 0
    try {
        fileSize = fs.statSync(filePath).size
    } catch {
        return null
    }
    return { filePath, fileSize, version: row.version }
}

export async function getLatestPublishedMap(): Promise<
    Partial<Record<ReleasePlatform, ReturnType<typeof rowToPublic>>>
> {
    const out: Partial<Record<ReleasePlatform, ReturnType<typeof rowToPublic>>> = {}
    for (const platform of ["darwin", "win32"] as const) {
        const row = await getLatestPublished(platform)
        if (row) out[platform] = rowToPublic(row)
    }
    return out
}

export async function patchRelease(
    id: number,
    patch: { isPublished?: boolean; isLatest?: boolean; releaseNotes?: string | null }
): Promise<AppReleaseRow | null> {
    const client = await pool.connect()
    try {
        await client.query("BEGIN")
        await client.query("SELECT pg_advisory_xact_lock(648923401)")
        const existing = (await client.query<AppReleaseRow>("SELECT * FROM app_releases WHERE id=$1 FOR UPDATE", [id]))
            .rows[0]
        if (!existing) {
            await client.query("COMMIT")
            return null
        }

        let isPublished = existing.is_published
        let isLatest = existing.is_latest
        let releaseNotes = existing.release_notes
        let publishedAt = existing.published_at

        if (patch.releaseNotes !== undefined) releaseNotes = patch.releaseNotes

        if (patch.isPublished !== undefined) {
            isPublished = patch.isPublished
            if (isPublished && !publishedAt) publishedAt = new Date()
            if (!isPublished) isLatest = false
        }

        if (patch.isLatest !== undefined) {
            isLatest = patch.isLatest
            if (isLatest) {
                isPublished = true
                if (!publishedAt) publishedAt = new Date()
            }
        }

        if (isLatest) {
            await client.query(`UPDATE app_releases SET is_latest = FALSE WHERE platform = $1 AND id <> $2`, [
                existing.platform,
                id
            ])
        }
        const r = await client.query<AppReleaseRow>(
            `UPDATE app_releases SET
                is_published = $2,
                is_latest = $3,
                release_notes = $4,
                published_at = $5
             WHERE id = $1
             RETURNING *`,
            [id, isPublished, isLatest, releaseNotes, publishedAt]
        )
        await client.query("COMMIT")
        return r.rows[0] ?? null
    } catch (e) {
        await client.query("ROLLBACK")
        throw e
    } finally {
        client.release()
    }
}

function feedFileName(platform: ReleasePlatform): string {
    return platform === "darwin" ? "latest-mac.yml" : "latest.yml"
}

function feedArtifact(row: AppReleaseRow): { name: string; sha512: string; size: number } {
    const name = row.update_filename || row.filename
    const sha512 = row.update_sha512 || row.sha512
    const size = Number(row.update_file_size ?? row.file_size)
    return { name, sha512, size }
}

export function buildUpdaterFeedYaml(row: AppReleaseRow): string {
    const artifact = feedArtifact(row)
    const base = getPublicDownloadBase()
    const fileUrl = `${base}/${row.platform}/${encodeURIComponent(artifact.name)}`
    const releaseDate = (row.published_at ?? row.created_at).toISOString()
    const lines = [
        `version: ${row.version}`,
        "files:",
        `  - url: ${fileUrl}`,
        `    sha512: ${artifact.sha512}`,
        `    size: ${artifact.size}`,
        `path: ${fileUrl}`,
        `sha512: ${artifact.sha512}`,
        `releaseDate: '${releaseDate}'`
    ]
    if (row.release_notes?.trim()) lines.push(`releaseNotes: ${JSON.stringify(row.release_notes)}`)
    return `${lines.join("\n")}\n`
}

export async function buildFeedForPlatform(platform: ReleasePlatform): Promise<string | null> {
    const row = await getLatestPublished(platform)
    if (!row) return null
    const artifact = feedArtifact(row)
    if (!isSafeFilename(artifact.name)) return null
    const filePath = resolvePathInsideDir(platformDir(platform), artifact.name)
    if (!filePath || !fs.existsSync(filePath)) return null
    return buildUpdaterFeedYaml(row)
}

export function releaseRowToAdminDto(row: AppReleaseRow) {
    return {
        id: row.id,
        version: row.version,
        platform: row.platform,
        filename: row.filename,
        updateFilename: row.update_filename,
        fileSize: Number(row.file_size),
        updateFileSize: row.update_file_size ? Number(row.update_file_size) : null,
        isPublished: row.is_published,
        isLatest: row.is_latest,
        releaseNotes: row.release_notes,
        publishedAt: row.published_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
        downloadUrl: `${getPublicDownloadBase()}/${row.platform}/${encodeURIComponent(row.filename)}`
    }
}

export function parseReleasePlatform(raw: string): ReleasePlatform | null {
    if (raw === "darwin" || raw === "mac" || raw === "macos") return "darwin"
    if (raw === "win32" || raw === "win" || raw === "windows") return "win32"
    return null
}
