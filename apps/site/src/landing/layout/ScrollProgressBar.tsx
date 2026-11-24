import { useEffect } from "react"
import { ensureGsapPlugins, gsap, prefersReducedMotion, ScrollTrigger } from "../../animations/gsapSetup"

export function ScrollProgressBar() {
    useEffect(() => {
        if (prefersReducedMotion()) return
        ensureGsapPlugins()
        const bar = document.querySelector<HTMLElement>(".scroll-progress")
        if (!bar) return

        const st = ScrollTrigger.create({
            start: 0,
            end: "max",
            onUpdate: (self) => {
                gsap.set(bar, { scaleX: self.progress, transformOrigin: "0% 50%" })
            },
        })

        return () => st.kill()
    }, [])

    if (prefersReducedMotion()) return null
    return <div className="scroll-progress" aria-hidden />
}
