import { BANNER_EFFECT_OPTIONS } from "../../profile/bannerEffects"
import { BannerWithEffect } from "./BannerWithEffect"
import { ProfileEffectPicker } from "./ProfileEffectPicker"
import styles from "./ProfileEffectsCarousel.module.css"

type BannerEffectsCarouselProps = {
    value: string
    onChange: (effectId: string) => void
    disabled?: boolean
    locked?: boolean
    allowedIds?: readonly string[]
    onMore?: () => void
    bannerUrl?: string | null
}

export function BannerEffectsCarousel({
    value,
    onChange,
    disabled,
    locked,
    allowedIds,
    onMore,
    bannerUrl
}: BannerEffectsCarouselProps) {
    return (
        <ProfileEffectPicker
            layout="banner"
            sectionTitle="Баннер"
            options={BANNER_EFFECT_OPTIONS}
            value={value}
            onChange={onChange}
            disabled={disabled}
            locked={locked}
            allowedIds={allowedIds}
            onMore={onMore}
            moreLabel="Ещё эффекты баннера"
            upgradePreviewId="ember"
            renderMini={(id) => (
                <div className={styles.bannerMini}>
                    <BannerWithEffect effect={id}>
                        {bannerUrl ? (
                            <img src={bannerUrl} alt="" className={styles.previewImage} />
                        ) : (
                            <div className={styles.bannerMiniPh} aria-hidden />
                        )}
                    </BannerWithEffect>
                </div>
            )}
        />
    )
}
