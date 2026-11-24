import { getApiBase } from "./apiBase"

export type ReleasePlatform = "darwin" | "win32"

export type LatestRelease = {
    id: number
    version: string
    platform: ReleasePlatform
    filename: string
    url: string
    fileSize: number
    releaseNotes: string | null
    publishedAt: string | null
}

export type LatestReleasesResponse = {
    releases: Partial<Record<ReleasePlatform, LatestRelease>>
}

export async function fetchLatestReleases(signal?: AbortSignal): Promise<LatestReleasesResponse> {
    const res = await fetch(`${getApiBase()}/releases/latest`, { signal })
    if (!res.ok) throw new Error("releases fetch failed")
    return (await res.json()) as LatestReleasesResponse
}

export function formatFileSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return ""
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} ГБ`
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} МБ`
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} КБ`
    return `${bytes} Б`
}

export function detectPreferredPlatform(): ReleasePlatform | null {
    if (typeof navigator === "undefined") return null
    const ua = navigator.userAgent.toLowerCase()
    if (ua.includes("win")) return "win32"
    if (ua.includes("mac")) return "darwin"
    return null
}

export function pickHeroDownloadUrl(data: LatestReleasesResponse | null): string | null {
    if (!data) return null
    const pref = detectPreferredPlatform()
    if (pref && data.releases[pref]?.url) return data.releases[pref]!.url
    return data.releases.darwin?.url ?? data.releases.win32?.url ?? null
}
