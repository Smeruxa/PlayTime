import { type RefObject } from "react"
import { ensureGsapPlugins, gsap, prefersReducedMotion, ScrollTrigger, useGSAP } from "../animations/gsapSetup"

type Options = {
    selector?: string
    start?: string
    stagger?: number
    y?: number
}

export function useScrollReveal(
    scopeRef: RefObject<HTMLElement | null>,
    {
        selector = "[data-reveal]",
        start = "top 88%",
        stagger = 0.08,
        y = 32,
    }: Options = {}
): void {
    ensureGsapPlugins()

    useGSAP(
        () => {
            if (prefersReducedMotion()) {
                gsap.set(selector, { opacity: 1, y: 0 })
                return
            }

            gsap.set(selector, { opacity: 0, y })

            ScrollTrigger.batch(selector, {
                start,
                once: true,
                onEnter: (batch) => {
                    gsap.to(batch, {
                        opacity: 1,
                        y: 0,
                        duration: 0.85,
                        ease: "power3.out",
                        stagger,
                        overwrite: true,
                    })
                },
            })
        },
        { scope: scopeRef, dependencies: [selector, start, stagger, y] }
    )
}
