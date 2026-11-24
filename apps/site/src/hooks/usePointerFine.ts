import { useEffect, useState } from "react"

export function usePointerFine(): boolean {
    const [fine, setFine] = useState(() => {
        if (typeof window === "undefined" || !window.matchMedia) return true
        return window.matchMedia("(hover: hover) and (pointer: fine)").matches
    })
    useEffect(() => {
        if (!window.matchMedia) return undefined
        const mq = window.matchMedia("(hover: hover) and (pointer: fine)")
        const h = () => setFine(mq.matches)
        mq.addEventListener("change", h)
        return () => mq.removeEventListener("change", h)
    }, [])
    return fine
}
