import { type RefObject } from "react"
import { gsap, prefersReducedMotion, useGSAP } from "../animations/gsapSetup"

export function useMagnetic(ref: RefObject<HTMLElement | null>, strength = 0.35): void {
    useGSAP(
        () => {
            const el = ref.current
            if (!el || prefersReducedMotion()) return

            const xTo = gsap.quickTo(el, "x", { duration: 0.45, ease: "power3.out" })
            const yTo = gsap.quickTo(el, "y", { duration: 0.45, ease: "power3.out" })

            const onMove = (e: PointerEvent) => {
                const r = el.getBoundingClientRect()
                const cx = r.left + r.width / 2
                const cy = r.top + r.height / 2
                xTo((e.clientX - cx) * strength)
                yTo((e.clientY - cy) * strength)
            }

            const onLeave = () => {
                xTo(0)
                yTo(0)
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
