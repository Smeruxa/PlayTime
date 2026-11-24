import { AVATAR_EFFECT_OPTIONS } from "../../profile/avatarEffects"
import { AvatarWithEffect } from "./AvatarWithEffect"
import { ProfileEffectPicker } from "./ProfileEffectPicker"
import styles from "./ProfileEffectsCarousel.module.css"

type ProfileEffectsCarouselProps = {
    value: string
    onChange: (effectId: string) => void
    disabled?: boolean
    locked?: boolean
    allowedIds?: readonly string[]
    onMore?: () => void
    avatarUrl?: string | null
    username: string
}

export function ProfileEffectsCarousel({
    value,
    onChange,
    disabled,
    locked,
    allowedIds,
    onMore,
    avatarUrl,
    username
}: ProfileEffectsCarouselProps) {
    return (
        <ProfileEffectPicker
            layout="avatar"
            sectionTitle="Аватар"
            options={AVATAR_EFFECT_OPTIONS}
            value={value}
            onChange={onChange}
            disabled={disabled}
            locked={locked}
            allowedIds={allowedIds}
            onMore={onMore}
            moreLabel="Ещё эффекты аватара"
            upgradePreviewId="flare"
            renderMini={(id) => (
                <div className={styles.mini}>
                    <AvatarWithEffect effect={id} compact>
                        {avatarUrl ? (
                            <img src={avatarUrl} alt="" className={styles.previewImage} />
                        ) : (
                            <span className={styles.miniPh} aria-hidden>
                                {(username.trim().charAt(0) || "?").toUpperCase()}
                            </span>
                        )}
                    </AvatarWithEffect>
                </div>
            )}
        />
    )
}
