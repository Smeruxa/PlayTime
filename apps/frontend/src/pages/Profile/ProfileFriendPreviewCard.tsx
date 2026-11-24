import { FiCamera, FiImage, FiUsers } from "react-icons/fi"
import { formatProfileDate } from "../../utils/compressAvatar"
import { AvatarWithEffect } from "./AvatarWithEffect"
import { PublicProfileCard, type PublicProfileCardData } from "../../components/PublicProfileCard/PublicProfileCard"
import styles from "./ProfileQuiet.module.css"
import { TextAccent } from "../../ui/primitives/TextAccent"
import type { PlanLimitsWire } from "../../types/subscription"
import { visibleAvatarEffect, visibleBannerEffect } from "../../../../shared/subscription/profileCustomization"

type ProfileFriendPreviewCardProps = {
    username: string
    createdAt: string
    status: string
    bio: string
    avatarPreview: string | null
    bannerUrl: string | null
    bannerEffect: string
    bannerSticker: string
    avatarEffect: string
    profileBannerAllowed: boolean
    profileBannerEffectsAllowed: boolean
    planLimits: PlanLimitsWire | null
    hasUnsavedChanges: boolean
    disabled?: boolean
    onEditAvatar: () => void
    onEditBanner: () => void
    onStatusChange: (value: string) => void
    onBioChange: (value: string) => void
}

export function ProfileFriendPreviewCard({
    username,
    createdAt,
    status,
    bio,
    avatarPreview,
    bannerUrl,
    bannerEffect,
    bannerSticker,
    avatarEffect,
    profileBannerAllowed,
    profileBannerEffectsAllowed,
    planLimits,
    hasUnsavedChanges,
    disabled,
    onEditAvatar,
    onEditBanner,
    onStatusChange,
    onBioChange
}: ProfileFriendPreviewCardProps) {
    const avatarEffectForPlan = visibleAvatarEffect(planLimits, avatarEffect)
    const profile: PublicProfileCardData = {
        username: username || "…",
        createdAt,
        status: status.trim(),
        bio: bio.trim(),
        avatar: avatarPreview,
        profileBanner: profileBannerAllowed ? bannerUrl : null,
        profileAvatarEffect: avatarEffectForPlan,
        profileBannerEffect: visibleBannerEffect(planLimits, bannerEffect),
        profileBannerSticker: profileBannerAllowed && profileBannerEffectsAllowed ? bannerSticker : "none"
    }

    return (
        <div className={styles.container}>
            <div className={styles.identity}>
                <button
                    type="button"
                    className={styles.avatarButton}
                    onClick={onEditAvatar}
                    disabled={disabled}
                    aria-label="Изменить фото профиля"
                    title="Изменить фото профиля"
                >
                    <AvatarWithEffect effect={avatarEffectForPlan}>
                        {avatarPreview ? (
                            <img src={avatarPreview} alt="" className={styles.avatarImage} />
                        ) : (
                            <span className={styles.avatarInitial} aria-hidden>
                                {(username.trim().charAt(0) || "?").toUpperCase()}
                            </span>
                        )}
                    </AvatarWithEffect>
                    <span className={styles.camera} aria-hidden>
                        <FiCamera />
                    </span>
                </button>
                <div className={styles.identityText}>
                    <h2 className={styles.name}>{username || "…"}</h2>
                    {createdAt ? (
                        <p className={styles.memberSince}>В PlayTime с {formatProfileDate(createdAt)}</p>
                    ) : null}
                </div>
            </div>

            <div className={styles.row}>
                <div className={styles.rowHeading}>
                    <label htmlFor="profile-status">Статус</label>
                    <p>Ваше настроение в одной строке.</p>
                </div>
                <input
                    id="profile-status"
                    disabled={disabled}
                    className={styles.field}
                    value={status}
                    maxLength={120}
                    placeholder="Например: на связи после 19:00"
                    onChange={(event) => onStatusChange(event.target.value)}
                />
            </div>
            <div className={styles.row}>
                <div className={styles.rowHeading}>
                    <label htmlFor="profile-bio">О себе</label>
                    <p>Немного о том, что вам нравится.</p>
                </div>
                <div className={styles.fieldGroup}>
                    <textarea
                        id="profile-bio"
                        disabled={disabled}
                        className={`${styles.field} ${styles.textarea}`}
                        value={bio}
                        maxLength={1000}
                        rows={3}
                        placeholder="Расскажите о себе в паре предложений"
                        onChange={(event) => onBioChange(event.target.value)}
                        aria-describedby="profile-bio-count"
                    />
                    <span id="profile-bio-count" className={styles.counter}>
                        {bio.length} / 1000
                    </span>
                </div>
            </div>
            <section className={styles.row} aria-labelledby="profile-friend-card-heading">
                <div className={styles.rowHeading}>
                    <h3 id="profile-friend-card-heading">Карточка у друзей</h3>
                    <p>
                        {hasUnsavedChanges
                            ? "Так будет выглядеть профиль после сохранения."
                            : "Так ваш профиль видят друзья."}
                    </p>
                    {profileBannerAllowed ? (
                        <button
                            type="button"
                            className={styles.bannerButton}
                            onClick={onEditBanner}
                            disabled={disabled}
                        >
                            <FiImage aria-hidden />
                            Изменить баннер
                        </button>
                    ) : null}
                </div>
                <div className={styles.previewFrame}>
                    <PublicProfileCard profile={profile} />
                </div>
            </section>
            <p className={styles.visibilityHint}>
                <FiUsers aria-hidden />
                Статус и <TextAccent>О себе</TextAccent> видят только друзья.
            </p>
        </div>
    )
}
