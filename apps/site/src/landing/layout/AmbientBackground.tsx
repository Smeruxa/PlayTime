import { useRef } from "react"
import { ensureGsapPlugins, gsap, prefersReducedMotion, useGSAP } from "../../animations/gsapSetup"
import { usePointerFine } from "../../hooks/usePointerFine"
import s from "./AmbientBackground.module.css"

export function AmbientBackground() {
    const rootRef = useRef<HTMLDivElement | null>(null)
    const spotRef = useRef<HTMLDivElement | null>(null)
    const fine = usePointerFine()
    const reduce = prefersReducedMotion()

    useGSAP(
        () => {
            if (reduce || !rootRef.current) return
            ensureGsapPlugins()

            const orbs = rootRef.current.querySelectorAll<HTMLElement>("[data-orb]")
            orbs.forEach((orb, i) => {
                gsap.to(orb, {
                    y: i % 2 === 0 ? "8vh" : "-6vh",
                    x: i % 2 === 0 ? "4vw" : "-3vw",
                    ease: "none",
                    scrollTrigger: {
                        trigger: document.body,
                        start: "top top",
                        end: "bottom bottom",
                        scrub: 1.2 + i * 0.15,
                    },
                })
            })

            if (fine && spotRef.current) {
                const spot = spotRef.current
                const xTo = gsap.quickTo(spot, "x", { duration: 0.8, ease: "power3.out" })
                const yTo = gsap.quickTo(spot, "y", { duration: 0.8, ease: "power3.out" })

                const onMove = (e: PointerEvent) => {
                    xTo(e.clientX)
                    yTo(e.clientY)
                }

                window.addEventListener("pointermove", onMove, { passive: true })
                return () => window.removeEventListener("pointermove", onMove)
            }
        },
        { scope: rootRef }
    )

    return (
        <div ref={rootRef} className={s.ambient} aria-hidden>
            <div className={s.ambient__base} />
            <div data-orb className={`${s.ambient__orb} ${s["ambient__orb--1"]}`} />
            <div data-orb className={`${s.ambient__orb} ${s["ambient__orb--2"]}`} />
            <div data-orb className={`${s.ambient__orb} ${s["ambient__orb--3"]}`} />
            <div data-orb className={`${s.ambient__orb} ${s["ambient__orb--4"]}`} />
            <div className={`${s.ambient__beam} ${s["ambient__beam--a"]}`} />
            <div className={`${s.ambient__beam} ${s["ambient__beam--b"]}`} />
            {!reduce && fine ? <div ref={spotRef} className={s.ambient__spot} /> : null}
            <div className={s.ambient__vignette} />
        </div>
    )
}
