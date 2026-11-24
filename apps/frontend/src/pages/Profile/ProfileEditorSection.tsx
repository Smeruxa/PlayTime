import { useState } from "react"
import { FiEye, FiUsers } from "react-icons/fi"
import type { PlanLimitsWire } from "../../types/subscription"
import { Modal, TextAccent } from "../../ui"
import { PublicProfileCard, type PublicProfileCardData } from "../../components/PublicProfileCard/PublicProfileCard"
import { ProfileEffectsCarousel } from "./ProfileEffectsCarousel"
import { BannerEffectsCarousel } from "./BannerEffectsCarousel"
import { BannerStickersCarousel } from "./BannerStickersCarousel"
import { PLAN_DISPLAY } from "./profilePlanPresentation"
import styles from "./ProfileAppearance.module.css"
import {
    allowedAvatarEffects,
    allowedBannerEffects,
    visibleAvatarEffect,
    visibleBannerEffect
} from "../../../../shared/subscription/profileCustomization"
import { ProfileUpgradeModal, type AppearanceUpgradeSection } from "./ProfileUpgradeModal"

type ProfileEditorSectionProps = {
    username: string
    status: string
    bio: string
    createdAt: string
    hasUnsavedChanges: boolean
    avatarPreview: string | null
    bannerPreview: string | null
    planSlug: string | null
    planLimits: PlanLimitsWire | null
    profileBannerAllowed: boolean
    profileBannerEffectsAllowed: boolean
    avatarEffectsAllowed: boolean
    avatarEffect: string
    bannerEffect: string
    bannerSticker: string
    disabled?: boolean
    onAvatarEffectChange: (id: string) => void
    onBannerEffectChange: (id: string) => void
    onBannerStickerChange: (id: string) => void
    onEditAvatar: () => void
    onEditBanner: () => void
    onRemoveAvatar: () => void
    onRemoveBanner: () => void
}

export function ProfileEditorSection(props: ProfileEditorSectionProps) {
    const [previewOpen, setPreviewOpen] = useState(false)
    const [upgradeSection, setUpgradeSection] = useState<AppearanceUpgradeSection | null>(null)
    const avatarEffect = visibleAvatarEffect(props.planLimits, props.avatarEffect)
    const bannerEffectsAllowed = props.profileBannerAllowed && props.profileBannerEffectsAllowed
    const bannerEffect = visibleBannerEffect(props.planLimits, props.bannerEffect)
    const visibleSticker = bannerEffectsAllowed ? props.bannerSticker : "none"
    const planName =
        props.planLimits?.displayName?.trim() ||
        (props.planSlug ? PLAN_DISPLAY[props.planSlug] || props.planSlug : null)
    const profile: PublicProfileCardData = {
        username: props.username || "…",
        status: props.status.trim(),
        bio: props.bio.trim(),
        createdAt: props.createdAt,
        avatar: props.avatarPreview,
        profileBanner: props.profileBannerAllowed ? props.bannerPreview : null,
        profileAvatarEffect: avatarEffect,
        profileBannerEffect: bannerEffect,
        profileBannerSticker: visibleSticker
    }
    return (
        <div className={styles.container}>
            <div className={styles.meta}>
                <p className={styles.visibility}>
                    <FiUsers aria-hidden />
                    Ваше оформление видят друзья
                </p>
                {planName ? <span className={styles.plan}>{planName}</span> : null}
            </div>
            <section className={styles.row} aria-labelledby="appearance-avatar-heading">
                <div className={styles.heading}>
                    <h2 id="appearance-avatar-heading">Аватар</h2>
                    <p>Рамка вокруг фото — в профиле, переписке и звонках.</p>
                    <div className={styles.mediaActions}>
                        <button
                            type="button"
                            className={styles.button}
                            disabled={props.disabled}
                            onClick={props.onEditAvatar}
                        >
                            Изменить фото
                        </button>
                        {props.avatarPreview ? (
                            <button
                                type="button"
                                className={`${styles.button} ${styles.link}`}
                                aria-label="Убрать фото профиля"
                                disabled={props.disabled}
                                onClick={props.onRemoveAvatar}
                            >
                                Убрать фото
                            </button>
                        ) : null}
                    </div>
                </div>
                <div className={styles.controls}>
                    <ProfileEffectsCarousel
                        value={avatarEffect}
                        onChange={props.onAvatarEffectChange}
                        disabled={props.disabled}
                        allowedIds={allowedAvatarEffects(props.planLimits)}
                        onMore={() => setUpgradeSection("avatar")}
                        avatarUrl={props.avatarPreview}
                        username={props.username}
                    />
                    {!props.avatarEffectsAllowed ? (
                        <p className={styles.gate}>
                            <TextAccent>Ореол</TextAccent> и <TextAccent>Орбита</TextAccent> — бесплатно. Остальные
                            рамки — с Medium.
                        </p>
                    ) : null}
                </div>
            </section>
            <section className={styles.row} aria-labelledby="appearance-banner-heading">
                <div className={styles.heading}>
                    <h2 id="appearance-banner-heading">Баннер</h2>
                    <p>Лёгкий свет или анимация поверх вашего изображения.</p>
                    <div className={styles.mediaActions}>
                        <button
                            type="button"
                            className={styles.button}
                            disabled={props.disabled || !props.profileBannerAllowed}
                            onClick={props.onEditBanner}
                        >
                            Изменить баннер
                        </button>
                        {props.profileBannerAllowed && props.bannerPreview ? (
                            <button
                                type="button"
                                className={`${styles.button} ${styles.link}`}
                                aria-label="Убрать баннер"
                                disabled={props.disabled}
                                onClick={props.onRemoveBanner}
                            >
                                Убрать баннер
                            </button>
                        ) : null}
                    </div>
                </div>
                <div className={styles.controls}>
                    <BannerEffectsCarousel
                        value={bannerEffect}
                        onChange={props.onBannerEffectChange}
                        disabled={props.disabled}
                        allowedIds={allowedBannerEffects(props.planLimits)}
                        onMore={() => setUpgradeSection("banner")}
                        bannerUrl={props.profileBannerAllowed ? props.bannerPreview : null}
                    />
                    {!props.profileBannerAllowed ? (
                        <p className={styles.gate}>
                            <TextAccent>Тихий свет</TextAccent> — бесплатно. Свой баннер — с Medium, остальные эффекты —
                            с Pro.
                        </p>
                    ) : !props.profileBannerEffectsAllowed ? (
                        <p className={styles.gate}>
                            <TextAccent>Тихий свет</TextAccent> включён. Остальные эффекты баннера — с Pro.
                        </p>
                    ) : null}
                </div>
            </section>
            <section className={styles.row} aria-labelledby="appearance-sticker-heading">
                <div className={styles.heading}>
                    <h2 id="appearance-sticker-heading">Наклейка</h2>
                    <p>Маленький акцент в правом углу баннера.</p>
                </div>
                <div className={styles.controls}>
                    <BannerStickersCarousel
                        value={visibleSticker}
                        onChange={props.onBannerStickerChange}
                        disabled={props.disabled}
                        locked={!bannerEffectsAllowed}
                        onMore={() => setUpgradeSection("sticker")}
                    />
                    {!bannerEffectsAllowed ? <p className={styles.gate}>Наклейки доступны с Pro.</p> : null}
                </div>
            </section>
            <button
                type="button"
                className={`${styles.button} ${styles.link} ${styles.previewButton}`}
                onClick={() => setPreviewOpen(true)}
            >
                <FiEye aria-hidden />
                Превью для друзей
            </button>
            {previewOpen ? (
                <Modal
                    title="Карточка у друзей"
                    onClose={() => setPreviewOpen(false)}
                    panelClassName={styles.previewModal}
                    footer={
                        <button type="button" className={styles.button} onClick={() => setPreviewOpen(false)}>
                            Закрыть
                        </button>
                    }
                >
                    <div className={styles.previewCard}>
                        <PublicProfileCard profile={profile} />
                    </div>
                    <p className={styles.previewNote}>
                        {props.hasUnsavedChanges
                            ? "Так будет выглядеть профиль после сохранения."
                            : "Так ваш профиль видят друзья."}
                    </p>
                </Modal>
            ) : null}
            {upgradeSection ? (
                <ProfileUpgradeModal section={upgradeSection} onClose={() => setUpgradeSection(null)} />
            ) : null}
        </div>
    )
}
