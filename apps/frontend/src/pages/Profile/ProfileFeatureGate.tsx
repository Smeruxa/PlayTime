import { IoLockClosedOutline } from "react-icons/io5"
import { SUBSCRIPTION_TELEGRAM_URL } from "../../config/supportLinks"
import styles from "./Profile.module.css"

type ProfileFeatureGateProps = {
    sectionTitle: string
    sectionIntro: string
    requiredPlan: string
    perks?: string[]
    variant?: "avatar" | "banner" | "bannerFx"
}

export function ProfileFeatureGate({
    sectionTitle,
    sectionIntro,
    requiredPlan,
    perks = [],
    variant = "avatar"
}: ProfileFeatureGateProps) {
    const previewClass =
        variant === "banner"
            ? styles.featureGatePreviewBanner
            : variant === "bannerFx"
              ? styles.featureGatePreviewBannerFx
              : styles.featureGatePreviewAvatar

    return (
        <div className={styles.featureGateSection}>
            <p className={styles.featureGateSectionTitle}>{sectionTitle}</p>
            <p className={styles.featureGateSectionIntro}>{sectionIntro}</p>
            <div className={styles.featureGate}>
                <div className={styles.featureGatePreview} aria-hidden>
                    <div className={previewClass} />
                    <div className={styles.featureGatePreviewShade} />
                    <span className={styles.featureGateLockBadge}>
                        <IoLockClosedOutline aria-hidden />
                    </span>
                </div>
                <div className={styles.featureGateBody}>
                    <p className={styles.featureGateLead}>
                        Доступно на тарифе{" "}
                        <span className={styles.featureGatePlan}>{requiredPlan}</span>
                    </p>
                    {perks.length > 0 ? (
                        <ul className={styles.featureGatePerks}>
                            {perks.map((p) => (
                                <li key={p}>{p}</li>
                            ))}
                        </ul>
                    ) : null}
                    <a
                        className={styles.featureGateCta}
                        href={SUBSCRIPTION_TELEGRAM_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Подключить тариф
                    </a>
                </div>
            </div>
        </div>
    )
}
