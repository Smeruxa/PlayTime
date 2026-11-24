import type { CSSProperties } from "react"
import {
    clampWallpaperPct,
    DM_WALLPAPER_IMAGE_DIM_DEFAULT,
    DM_WALLPAPER_IMAGE_BLUR_DEFAULT,
    parseDmWallpaperState,
    type DmWallpaperState
} from "../../../../shared/types/contracts/dmWallpaper"

export { DM_WALLPAPER_IMAGE_DIM_DEFAULT, DM_WALLPAPER_IMAGE_BLUR_DEFAULT, type DmWallpaperState }

export const DM_WALLPAPER_IMAGE_BLUR_MAX_PX = 24

export const DM_WALLPAPER_PRESETS: ReadonlyArray<{ id: string; title: string; gradient: string }> = [
    { id: "aurora", title: "Сияние", gradient: "linear-gradient(165deg, #1a1f35 0%, #2d1f4a 42%, #153a40 100%)" },
    { id: "dusk", title: "Закат", gradient: "linear-gradient(180deg, #2b1022 0%, #1f2840 48%, #0d1826 100%)" },
    { id: "ocean", title: "Океан", gradient: "linear-gradient(145deg, #0a2342 0%, #0d4d4d 45%, #061a2e 100%)" },
    { id: "warm", title: "Тепло", gradient: "linear-gradient(160deg, #2a1810 0%, #3d2818 50%, #1a1510 100%)" },
    { id: "forest", title: "Лес", gradient: "linear-gradient(135deg, #0f2218 0%, #1a3328 50%, #0d1812 100%)" },
    { id: "mono", title: "Графит", gradient: "linear-gradient(140deg, #222228 0%, #2a2a32 50%, #18181c 100%)" },
    { id: "rose", title: "Роза", gradient: "linear-gradient(155deg, #301820 0%, #281828 45%, #181622 100%)" },
    { id: "slate", title: "Сланец", gradient: "linear-gradient(120deg, #1c2430 0%, #252038 50%, #141c24 100%)" }
]

const PRESET_BY_ID = new Map(DM_WALLPAPER_PRESETS.map((p) => [p.id, p.gradient]))

function storageKey(myUsername: string, peerUsername: string, ownerId?: number | null, peerId?: number): string {
    if (ownerId != null && peerId != null) return `playtime:dmWallpaper:v2:${ownerId}:${peerId}`
    return `playtime:dmWallpaper:v1:${myUsername}:${peerUsername}`
}

export function wallpaperBlurPctToPx(blurPct: number): number {
    const pct = clampWallpaperPct(blurPct, DM_WALLPAPER_IMAGE_BLUR_DEFAULT)
    return (pct / 100) * DM_WALLPAPER_IMAGE_BLUR_MAX_PX
}

export function wallpaperDimToBlackAlpha(dimPct: number): number {
    return clampWallpaperPct(dimPct, DM_WALLPAPER_IMAGE_DIM_DEFAULT) / 100
}

export function loadDmWallpaper(
    myUsername: string,
    peerUsername: string,
    ownerId?: number | null,
    peerId?: number
): DmWallpaperState {
    try {
        const raw = localStorage.getItem(storageKey(myUsername, peerUsername, ownerId, peerId))
        if (!raw) return { kind: "none" }
        return parseDmWallpaperState(JSON.parse(raw)) ?? { kind: "none" }
    } catch {
    }
    return { kind: "none" }
}

export function saveDmWallpaper(
    myUsername: string,
    peerUsername: string,
    state: DmWallpaperState,
    ownerId?: number | null,
    peerId?: number
): void {
    const validated = parseDmWallpaperState(state)
    if (!validated) return
    try {
        if (validated.kind === "none") {
            localStorage.removeItem(storageKey(myUsername, peerUsername, ownerId, peerId))
            return
        }
        localStorage.setItem(storageKey(myUsername, peerUsername, ownerId, peerId), JSON.stringify(validated))
    } catch {
    }
}

export function dmWallpaperPanelStyle(state: DmWallpaperState): CSSProperties | undefined {
    if (state.kind === "none") return undefined
    if (state.kind === "image") return undefined
    const dimPreset = "linear-gradient(rgba(0, 0, 0, 0.24), rgba(0, 0, 0, 0.24))"
    const g = PRESET_BY_ID.get(state.id)
    if (!g) return undefined
    return { backgroundImage: `${dimPreset}, ${g}` }
}
