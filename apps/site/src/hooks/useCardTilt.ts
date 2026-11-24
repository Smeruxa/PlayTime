import { type RefObject } from "react"
import { gsap, prefersReducedMotion, useGSAP } from "../animations/gsapSetup"

type Options = { maxDeg?: number; lift?: number }

export function useCardTilt(
    ref: RefObject<HTMLElement | null>,
    { maxDeg = 8, lift = 6 }: Options = {}
): void {
    useGSAP(
        () => {
            const el = ref.current
            if (!el || prefersReducedMotion()) return

            const rotX = gsap.quickTo(el, "rotateX", { duration: 0.5, ease: "power2.out" })
            const rotY = gsap.quickTo(el, "rotateY", { duration: 0.5, ease: "power2.out" })
            const y = gsap.quickTo(el, "y", { duration: 0.5, ease: "power2.out" })

            const onMove = (e: PointerEvent) => {
                const r = el.getBoundingClientRect()
                const px = (e.clientX - r.left) / r.width - 0.5
                const py = (e.clientY - r.top) / r.height - 0.5
                rotY(px * maxDeg)
                rotX(-py * maxDeg)
                y(-lift)
            }

            const onLeave = () => {
                rotX(0)
                rotY(0)
                y(0)
            }

            el.addEventListener("pointermove", onMove)
            el.addEventListener("pointerleave", onLeave)
            return () => {
                el.removeEventListener("pointermove", onMove)
                el.removeEventListener("pointerleave", onLeave)
            }
        },
        { scope: ref }
    )
}
