import { useEffect, useRef } from "react"

export function useWindowFocused(): { current: boolean } {
    const ref = useRef(true)

    useEffect(() => {
        const api = window.electronAPI
        if (!api?.onWindowFocusChanged) {
            ref.current = document.hasFocus()
            const onVis = () => {
                ref.current = document.visibilityState === "visible" && document.hasFocus()
            }
            document.addEventListener("visibilitychange", onVis)
            window.addEventListener("focus", onVis)
            window.addEventListener("blur", onVis)
            return () => {
                document.removeEventListener("visibilitychange", onVis)
                window.removeEventListener("focus", onVis)
                window.removeEventListener("blur", onVis)
            }
        }
        void api.isWindowFocused?.().then((v) => {
            ref.current = !!v
        })
        return api.onWindowFocusChanged((focused) => {
            ref.current = focused
        })
    }, [])

    return ref
}
