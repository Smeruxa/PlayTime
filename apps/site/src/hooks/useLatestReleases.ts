import { useEffect, useState } from "react"
import {
    detectPreferredPlatform,
    fetchLatestReleases,
    formatFileSize,
    pickHeroDownloadUrl,
    type LatestReleasesResponse,
} from "../config/releases"

export function useLatestReleases() {
    const [data, setData] = useState<LatestReleasesResponse | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)

    useEffect(() => {
        const ac = new AbortController()
        ;(async () => {
            try {
                const body = await fetchLatestReleases(ac.signal)
                setData(body)
            } catch {
                if (!ac.signal.aborted) setError(true)
            } finally {
                if (!ac.signal.aborted) setLoading(false)
            }
        })()
        return () => ac.abort()
    }, [])

    const heroUrl = pickHeroDownloadUrl(data)
    const preferred = detectPreferredPlatform()

    return { data, loading, error, heroUrl, preferred, formatFileSize }
}
