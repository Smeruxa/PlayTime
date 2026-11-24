import { useEffect } from "react"
import { flushRevocationOutbox } from "../../utils/api/revocationOutbox"

export function useRevocationOutbox() {
    useEffect(() => {
        let running = false
        let disposed = false
        const flush = () => {
            if (disposed || running || navigator.onLine === false) return
            running = true
            void flushRevocationOutbox().finally(() => {
                running = false
            })
        }
        const visible = () => {
            if (document.visibilityState === "visible") flush()
        }
        flush()
        const timer = window.setInterval(flush, 60_000)
        window.addEventListener("online", flush)
        document.addEventListener("visibilitychange", visible)
        return () => {
            disposed = true
            window.clearInterval(timer)
            window.removeEventListener("online", flush)
            document.removeEventListener("visibilitychange", visible)
        }
    }, [])
}
