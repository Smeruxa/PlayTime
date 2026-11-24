import { useRef } from "react"
import { ensureGsapPlugins, gsap, prefersReducedMotion, useGSAP } from "../animations/gsapSetup"
import { useScrollReveal } from "../hooks/useScrollReveal"
import s from "./HowItWorksSection.module.css"

const steps = [
    {
        n: "01",
        title: "Скачайте приложение",
        text: "Установите PlayTime на Mac или Windows — одно окно, всегда под рукой.",
    },
    {
        n: "02",
        title: "Создайте комнату или чат",
        text: "Пригласите команду или начните личный диалог.",
    },
    {
        n: "03",
        title: "Общайтесь как удобно",
        text: "Пишите, звоните или покажите экран — всё в одном месте.",
    },
] as const

export function HowItWorksSection() {
    const ref = useRef<HTMLElement | null>(null)
    const lineRef = useRef<HTMLDivElement | null>(null)
    const reduce = prefersReducedMotion()

    useScrollReveal(ref, { selector: "[data-reveal]", stagger: 0.1, y: 24 })

    useGSAP(
        () => {
            const line = lineRef.current
            const section = ref.current
            if (!line || !section || reduce) return
            ensureGsapPlugins()

            gsap.fromTo(
                line,
                { scaleY: 0 },
                {
                    scaleY: 1,
                    ease: "none",
                    scrollTrigger: {
                        trigger: section,
                        start: "top 65%",
                        end: "bottom 40%",
                        scrub: 0.5,
                    },
                }
            )
        },
        { scope: ref }
    )

    return (
        <section ref={ref} className={`section section--center ${s.how}`} id="how" aria-labelledby="how-h">
            <div className={s.head}>
                <p className="eyebrow section__label" data-reveal>
                    Как это работает
                </p>
                <h2 id="how-h" data-reveal>
                    Три шага до разговора
                </h2>
            </div>
            <ol className={s.steps}>
                <div ref={lineRef} className={s.line} aria-hidden />
                {steps.map(({ n, title, text }) => (
                    <li key={n} className={s.step} data-reveal>
                        <span className={s.num}>{n}</span>
                        <div className={s.body}>
                            <h3>{title}</h3>
                            <p>{text}</p>
                        </div>
                    </li>
                ))}
            </ol>
        </section>
    )
}
