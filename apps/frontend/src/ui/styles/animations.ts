import type { Transition, Variants } from "framer-motion"

export const easeOut = [0.32, 0.72, 0, 1] as const

export const fadeIn: Variants = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 }
}

export const slideUp: Variants = {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 4 }
}

export const slideFromRight: Variants = {
    initial: { x: "100%" },
    animate: { x: 0 },
    exit: { x: "100%" }
}

export const transitionFast: Transition = {
    type: "tween",
    duration: 0.15,
    ease: easeOut
}

export const transitionNormal: Transition = {
    type: "tween",
    duration: 0.28,
    ease: easeOut
}

export const scaleIn = {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.98 },
    transition: transitionNormal
}

export const drawerTransition: Transition = {
    type: "spring",
    stiffness: 380,
    damping: 36
}

export const drawerSlide = {
    initial: { x: "100%" },
    animate: { x: 0 },
    exit: { x: "100%" },
    transition: drawerTransition
}

export const overlayFade = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: transitionNormal
}

export function useReducedMotion(): boolean {
    if (typeof window === "undefined") return false
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}
