import { useRef } from "react"
import { SectionBackdrop } from "../decorative/SectionBackdrop"
import { IconCheck } from "../icons/PlayTimeIcons"
import { useScrollReveal } from "../../hooks/useScrollReveal"
import { ChatPreview } from "./previews/ChatPreview"
import { ScreenPreview } from "./previews/ScreenPreview"
import { VoicePreview } from "./previews/VoicePreview"
import { showcaseExtras, showcaseFeatures } from "./showcaseData"
import styles from "./ShowcaseSection.module.css"

function FeaturePreview({ variant }: { variant: (typeof showcaseFeatures)[number]["variant"] }) {
    if (variant === "chat") return <ChatPreview />
    if (variant === "voice") return <VoicePreview />
    return <ScreenPreview />
}

function FeatureIcon({ icon: Icon }: { icon: (typeof showcaseFeatures)[number]["icon"] }) {
    return (
        <span className={styles.featureIcon} aria-hidden>
            <Icon size={22} />
        </span>
    )
}

function PointList({ items }: { items: readonly string[] }) {
    return (
        <ul className={styles.points}>
            {items.map((p) => (
                <li key={p}>
                    <IconCheck size={14} className={styles.pointCheck} />
                    {p}
                </li>
            ))}
        </ul>
    )
}

export function ShowcaseSection() {
    const ref = useRef<HTMLElement | null>(null)
    useScrollReveal(ref, { selector: "[data-reveal]", stagger: 0.08, y: 28 })

    return (
        <section ref={ref} className={styles.showcase} id="showcase" aria-labelledby="showcase-h">
            <SectionBackdrop variant="grid-orbs" />

            <div className={styles.showcase__head}>
                <p className="eyebrow section__label" data-reveal>
                    Продукт
                </p>
                <h2 id="showcase-h" data-reveal>
                    PlayTime для команд и друзей
                </h2>
                <p className={`lead ${styles.showcase__lead}`} data-reveal>
                    Чаты, звонки и экран — в одном окне на Mac и Windows. Ниже — три сценария, с которых обычно
                    начинают.
                </p>
            </div>

            <div className={styles.spotlights}>
                {showcaseFeatures.map((f, i) => {
                    const reversed = i % 2 === 1
                    return (
                        <article
                            key={f.title}
                            className={`${styles.spotlight}${reversed ? ` ${styles.spotlightReverse}` : ""}`}
                            data-reveal
                        >
                            <div className={styles.spotlightVisual}>
                                <FeaturePreview variant={f.variant} />
                            </div>
                            <div className={styles.spotlightCopy}>
                                <FeatureIcon icon={f.icon} />
                                <h3>{f.title}</h3>
                                <p>{f.text}</p>
                                <PointList items={f.points} />
                            </div>
                        </article>
                    )
                })}
            </div>

            <div className={styles.extras} data-reveal>
                <div className={styles.extrasHead}>
                    <p className={styles.extrasEyebrow}>Ещё в PlayTime</p>
                    <h3 className={styles.extrasTitle}>Больше для общения и работы</h3>
                    <p className={styles.extrasLead}>
                        Помимо чатов и созвонов — инструменты, которые остаются под рукой каждый день.
                    </p>
                </div>
                <ul className={styles.extrasGrid}>
                    {showcaseExtras.map(({ icon: Icon, title, text }) => (
                        <li key={title} className={styles.extraCard}>
                            <span className={styles.extraIcon} aria-hidden>
                                <Icon size={20} />
                            </span>
                            <strong>{title}</strong>
                            <span>{text}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    )
}
