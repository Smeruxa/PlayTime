import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { useGSAP } from "@gsap/react"

let registered = false

export function ensureGsapPlugins(): void {
    if (registered) return
    gsap.registerPlugin(ScrollTrigger, useGSAP)
    registered = true
}

export function prefersReducedMotion(): boolean {
    if (typeof window === "undefined") return false
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

export { gsap, ScrollTrigger, useGSAP }
