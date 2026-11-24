import { wallpaperBlurPctToPx, wallpaperDimToBlackAlpha } from "../dmWallpaperStorage"
import { isWallpaperImageDataUrl } from "../../../../../shared/types/contracts/dmWallpaper"
import styles from "./DmWallpaperImageBackdrop.module.css"

type DmWallpaperImageBackdropProps = {
    dataUrl: string
    dim: number
    blur: number
    className?: string
}

export function DmWallpaperImageBackdrop({ dataUrl, dim, blur, className }: DmWallpaperImageBackdropProps) {
    if (!isWallpaperImageDataUrl(dataUrl)) return null
    const blurPx = wallpaperBlurPctToPx(blur)
    const dimAlpha = wallpaperDimToBlackAlpha(dim)
    return (
        <div className={`${styles.root} ${className ?? ""}`} aria-hidden>
            <div
                className={styles.blurPlate}
                style={{
                    backgroundImage: `url("${dataUrl}")`,
                    filter: blurPx > 0 ? `blur(${blurPx}px)` : undefined
                }}
            />
            <div
                className={styles.dimLayer}
                style={{
                    background: `linear-gradient(rgba(0, 0, 0, ${dimAlpha}), rgba(0, 0, 0, ${dimAlpha}))`
                }}
            />
        </div>
    )
}
