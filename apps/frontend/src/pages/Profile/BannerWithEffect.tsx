import { bannerStickerChar } from "../../profile/bannerStickers"
import { normalizeBannerEffect } from "../../profile/bannerEffects"
import { BannerEffectOverlay } from "./effects/BannerEffectOverlay"
import styles from "./BannerWithEffect.module.css"

type BannerWithEffectProps = {
    effect: string
    sticker?: string
    className?: string
    children: React.ReactNode
}

function StickerGlyph({ stickerId }: { stickerId: string }) {
    if (!stickerId || stickerId === "none") return null
    const ch = bannerStickerChar(stickerId)
    if (!ch) return null
    return (
        <span className={styles.sticker} aria-hidden>
            {ch}
        </span>
    )
}

export function BannerWithEffect({ effect, sticker = "none", className, children }: BannerWithEffectProps) {
    const id = normalizeBannerEffect(effect)
    const wrapClass = [styles.wrap, id !== "none" ? styles.wrapActive : "", className].filter(Boolean).join(" ")

    return (
        <div className={wrapClass} data-effect={id}>
            <div className={styles.inner}>{children}</div>
            {id !== "none" ? <BannerEffectOverlay effectId={id} /> : null}
            <StickerGlyph stickerId={sticker} />
        </div>
    )
}
