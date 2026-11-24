import { AvatarWithEffect } from "./AvatarWithEffect"
import { BannerWithEffect } from "./BannerWithEffect"
import styles from "./Profile.module.css"

type ProfileAppearanceIntroProps = {
    username: string
    avatarPreview: string | null
    bannerPreview: string | null
    profileBannerAllowed: boolean
    avatarEffect: string
    bannerEffect: string
    bannerSticker: string
}

export function ProfileAppearanceIntro({
    username,
    avatarPreview,
    bannerPreview,
    profileBannerAllowed,
    avatarEffect,
    bannerEffect,
    bannerSticker
}: ProfileAppearanceIntroProps) {
    const initial = (username.trim().charAt(0) || "?").toUpperCase()

    return (
        <div className={styles.appearanceIntro}>
            <div className={styles.appearanceIntroBanner}>
                {profileBannerAllowed || bannerPreview ? (
                    <BannerWithEffect effect={bannerEffect} sticker={bannerSticker}>
                        {bannerPreview ? (
                            <img src={bannerPreview} alt="" className={styles.appearanceIntroBannerImg} />
                        ) : (
                            <div className={styles.appearanceIntroBannerPh} aria-hidden />
                        )}
                    </BannerWithEffect>
                ) : (
                    <div className={styles.appearanceIntroBannerPh} aria-hidden />
                )}
            </div>
            <div className={styles.appearanceIntroBody}>
                <div className={styles.appearanceIntroAvatar}>
                    <AvatarWithEffect effect={avatarEffect}>
                        {avatarPreview ? (
                            <img src={avatarPreview} alt="" className={styles.appearanceIntroAvatarImg} />
                        ) : (
                            <span className={styles.appearanceIntroAvatarPh} aria-hidden>
                                {initial}
                            </span>
                        )}
                    </AvatarWithEffect>
                </div>
                <p className={styles.appearanceIntroName}>{username || "…"}</p>
            </div>
            <p className={styles.appearanceIntroCaption}>Так отображается профиль у друзей</p>
        </div>
    )
}
