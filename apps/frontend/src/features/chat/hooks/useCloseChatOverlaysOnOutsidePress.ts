import { useEffect, type RefObject } from "react"

export function useCloseChatOverlaysOnOutsidePress(
    menuWrapRef: RefObject<HTMLDivElement | null>,
    readersWrapRef: RefObject<HTMLDivElement | null>,
    onOutside: () => void
) {
    useEffect(() => {
        const down = (ev: Event) => {
            const t = ev.target as Node
            if (menuWrapRef.current?.contains(t)) return
            if (readersWrapRef.current?.contains(t)) return
            onOutside()
        }
        document.addEventListener("mousedown", down)
        return () => document.removeEventListener("mousedown", down)
    }, [menuWrapRef, readersWrapRef, onOutside])
}
