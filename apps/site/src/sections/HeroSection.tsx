import { useRef } from "react"
import { useLatestReleases } from "../hooks/useLatestReleases"
import { useMagnetic } from "../hooks/useMagnetic"
import { GlassOrbs, HeroMockup } from "../landing"
import { ensureGsapPlugins, gsap, prefersReducedMotion, useGSAP } from "../animations/gsapSetup"
import { splitChars, splitWords } from "../utils/splitText"
import s from "./HeroSection.module.css"

const stats = [
    { value: "Чаты", label: "Команда и друзья" },
    { value: "Звонки", label: "Голос и экран" },
    { value: "Mac · Win", label: "Приложение" },
] as const

export function HeroSection() {
    const ref = useRef<HTMLElement | null>(null)
    const primaryBtnRef = useRef<HTMLAnchorElement | null>(null)
    const reduce = prefersReducedMotion()
    const { heroUrl } = useLatestReleases()

    useMagnetic(primaryBtnRef)

    useGSAP(
        () => {
            if (reduce) return
            ensureGsapPlugins()

            const tl = gsap.timeline({ defaults: { ease: "power4.out" } })

            tl.from("[data-animate='badge']", { opacity: 0, y: 20, filter: "blur(8px)", duration: 0.7 })
                .from(
                    "[data-split-char]",
                    {
                        opacity: 0,
                        y: 48,
                        duration: 0.75,
                        stagger: { each: 0.03, from: "start" },
                    },
                    "-=0.4"
                )
                .from(
                    "[data-split-word]",
                    { opacity: 0, y: 20, duration: 0.55, stagger: 0.06 },
                    "-=0.5"
                )
                .from("[data-animate='lede']", { opacity: 0, y: 16, duration: 0.55 }, "-=0.4")
                .from(
                    "[data-animate='cta'] .btn",
                    { opacity: 0, y: 14, scale: 0.97, duration: 0.45, stagger: 0.08 },
                    "-=0.3"
                )
                .from("[data-animate='mock']", { opacity: 0, y: 40, scale: 0.96, duration: 1 }, "-=0.5")
                .from("[data-animate='stat']", { opacity: 0, y: 12, duration: 0.4, stagger: 0.06 }, "-=0.6")
        },
        { scope: ref }
    )

    return (
        <header ref={ref} className={s.hero} id="top">
            <GlassOrbs className={s.heroOrbs} intensity="soft" />
            <div className={s["hero__copy"]}>
                <p className={s["hero__badge"]} data-animate="badge">
                    <span className={s["hero__badge-dot"]} aria-hidden />
                    Связь для команд и друзей
                </p>
                <h1 className={`${s["hero__title"]} display`}>
                    <span className={s["hero__title-line"]}>{splitChars("PlayTime")}</span>
                </h1>
                <p className={`${s["hero__subtitle"]} display`}>
                    {splitWords("общение в одном месте")}
                </p>
                <p className={s["hero__lede"]} id="echo" data-animate="lede">
                    Сообщения, звонки и совместная работа — в одном приложении для Mac и Windows.
                </p>
                <div className={s["hero__cta"]} data-animate="cta">
                    <a
                        ref={primaryBtnRef}
                        className="btn btn--primary btn--lg btn--shine"
                        href={heroUrl ?? "#download"}
                    >
                        Скачать бесплатно
                    </a>
                    <a className="btn btn--ghost btn--lg" href="#features">
                        Возможности
                    </a>
                </div>
            </div>

            <div className={s["hero__visual-wrap"]} aria-hidden={reduce} data-animate="mock">
                <div className={s["hero__visual"]}>
                    <HeroMockup />
                </div>
            </div>

            <ul className={s["hero__stats"]} aria-label="Ключевые характеристики">
                {stats.map(({ value, label }) => (
                    <li key={value} className={s["hero__stat"]} data-animate="stat">
                        <span className={s["hero__stat-value"]}>{value}</span>
                        <span className={s["hero__stat-label"]}>{label}</span>
                    </li>
                ))}
            </ul>
        </header>
    )
}
