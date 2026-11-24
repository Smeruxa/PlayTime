import { FiArrowUpRight, FiCheck } from "react-icons/fi"
import { Modal, TextAccent } from "../../ui"
import { AvatarWithEffect } from "./AvatarWithEffect"
import { BannerWithEffect } from "./BannerWithEffect"
import { AVATAR_EFFECT_IDS } from "../../profile/avatarEffects"
import { BANNER_EFFECT_IDS } from "../../profile/bannerEffects"
import styles from "./ProfileUpgradeModal.module.css"

export type AppearanceUpgradeSection = "avatar" | "banner" | "sticker"
export const APPEARANCE_PLANS_URL = "https://smeruxa.ru/playtime/#appearance-plans"

export function ProfileUpgradeModal({ section, onClose }: { section: AppearanceUpgradeSection; onClose: () => void }) {
    const recommended = section === "avatar" ? "Medium" : "Pro"
    return (
        <Modal
            title="Больше оформления"
            onClose={onClose}
            panelClassName={styles.modal}
            footer={
                <>
                    <button type="button" className={styles.later} onClick={onClose}>
                        Не сейчас
                    </button>
                    <a className={styles.action} href={APPEARANCE_PLANS_URL} target="_blank" rel="noreferrer">
                        Сравнить тарифы <FiArrowUpRight aria-hidden />
                    </a>
                </>
            }
        >
            <div className={styles.samples} aria-hidden>
                <div className={styles.sampleBanner}>
                    <BannerWithEffect effect="ember">
                        <div className={styles.bannerFill} />
                    </BannerWithEffect>
                </div>
                <div className={styles.sampleAvatar}>
                    <AvatarWithEffect effect="flare">
                        <span>А</span>
                    </AvatarWithEffect>
                </div>
            </div>
            <p className={styles.lead}>Откройте остальные эффекты и соберите свой стиль.</p>
            <p className={styles.note}>
                На Free остаются две рамки аватара и лёгкий <TextAccent>Тихий свет</TextAccent> для баннера.
            </p>
            <div className={styles.plans}>
                {[
                    {
                        name: "Medium",
                        features: [
                            `Все эффекты аватара: ${AVATAR_EFFECT_IDS.length - 1}`,
                            "Загрузка своего баннера",
                            "Лёгкий эффект Тихий свет"
                        ]
                    },
                    {
                        name: "Pro",
                        features: [
                            "Всё оформление из Medium",
                            `Все эффекты баннера: ${BANNER_EFFECT_IDS.length - 1}`,
                            "Наклейки на баннер"
                        ]
                    }
                ].map((plan) => (
                    <section
                        key={plan.name}
                        className={`${styles.plan}${plan.name === recommended ? ` ${styles.recommended}` : ""}`}
                    >
                        <h3>
                            {plan.name}
                            {plan.name === recommended ? <span>Для этих эффектов</span> : null}
                        </h3>
                        <ul>
                            {plan.features.map((feature) => (
                                <li key={feature}>
                                    <FiCheck aria-hidden />
                                    {feature}
                                </li>
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
            <p className={styles.footnote}>
                В Enterprise также входит всё оформление Pro. Подробнее — на сайте PlayTime.
            </p>
        </Modal>
    )
}
