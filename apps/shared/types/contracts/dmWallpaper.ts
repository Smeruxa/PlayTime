const presets = new Set(["aurora", "dusk", "ocean", "warm", "forest", "mono", "rose", "slate"])
const imageDataUrl = /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/]+={0,2}(?![\s\S])/i

export const MAX_WALLPAPER_PAYLOAD_CHARS = 480_000
export const DM_WALLPAPER_IMAGE_DIM_DEFAULT = 38
export const DM_WALLPAPER_IMAGE_BLUR_DEFAULT = 0

export type DmWallpaperState =
    | { kind: "none" }
    | { kind: "preset"; id: string }
    | { kind: "image"; dataUrl: string; dim: number; blur: number }

export function isWallpaperImageDataUrl(value: unknown): value is string {
    return typeof value === "string" && value.length <= MAX_WALLPAPER_PAYLOAD_CHARS && imageDataUrl.test(value)
}

export function clampWallpaperPct(value: unknown, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback
    return Math.min(100, Math.max(0, Math.round(value)))
}

export function parseDmWallpaperState(value: unknown): DmWallpaperState | null {
    if (!value || typeof value !== "object") return null
    const { kind, id, dataUrl, dim, blur } = value as Record<string, unknown>
    if (kind === "none") return { kind }
    if (kind === "preset" && typeof id === "string" && presets.has(id)) return { kind, id }
    if (kind !== "image" || !isWallpaperImageDataUrl(dataUrl)) return null
    return {
        kind,
        dataUrl,
        dim: clampWallpaperPct(dim, DM_WALLPAPER_IMAGE_DIM_DEFAULT),
        blur: clampWallpaperPct(blur, DM_WALLPAPER_IMAGE_BLUR_DEFAULT)
    }
}
