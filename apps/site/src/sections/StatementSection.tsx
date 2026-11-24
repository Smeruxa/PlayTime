import { useRef } from "react"
import { ensureGsapPlugins, gsap, prefersReducedMotion, useGSAP } from "../animations/gsapSetup"
import { GlassOrbs } from "../landing"
import { splitWords } from "../utils/splitText"
import s from "./StatementSection.module.css"

export function StatementSection() {
    const ref = useRef<HTMLElement | null>(null)
    const glowRef = useRef<HTMLDivElement | null>(null)
    const reduce = prefersReducedMotion()

    useGSAP(
        () => {
            const section = ref.current
            const glow = glowRef.current
            if (!section || reduce) return
            ensureGsapPlugins()

            const words = section.querySelectorAll<HTMLElement>("[data-split-word]")
            gsap.set(words, { opacity: 0.25, y: 20 })
            gsap.to(words, {
                opacity: 1,
                y: 0,
                stagger: 0.08,
                ease: "power3.out",
                scrollTrigger: {
                    trigger: section,
                    start: "top 70%",
                    end: "center center",
                    scrub: 0.65,
                },
            })

            if (glow) {
                gsap.from(glow, {
                    scale: 0.6,
                    opacity: 0,
                    scrollTrigger: {
                        trigger: section,
                        start: "top 80%",
                        end: "bottom 20%",
                        scrub: 1,
                    },
                })
            }
        },
        { scope: ref }
    )

    return (
        <section ref={ref} className={s.statement} aria-hidden={false}>
            <GlassOrbs className={s.statementOrbs} intensity="soft" />
            <div ref={glowRef} className={s.statement__glow} aria-hidden />
            <p className={`${s.statement__line} display`}>{splitWords("Общение, которому можно доверять.")}</p>
        </section>
    )
}
