import { BANNER_STICKER_OPTIONS, bannerStickerChar } from "../../profile/bannerStickers"
import { FiMinus } from "react-icons/fi"
import { ProfileEffectPicker } from "./ProfileEffectPicker"

type BannerStickersCarouselProps = {
    value: string
    onChange: (stickerId: string) => void
    disabled?: boolean
    locked?: boolean
    onMore?: () => void
}

export function BannerStickersCarousel({ value, onChange, disabled, locked, onMore }: BannerStickersCarouselProps) {
    return (
        <ProfileEffectPicker
            layout="sticker"
            sectionTitle="Наклейка на баннер"
            options={BANNER_STICKER_OPTIONS}
            value={value}
            onChange={onChange}
            disabled={disabled}
            locked={locked}
            onMore={onMore}
            moreLabel="Ещё наклейки"
            upgradePreviewId="fire"
            renderMini={(id) => <span aria-hidden>{bannerStickerChar(id) || <FiMinus size={22} />}</span>}
        />
    )
}
