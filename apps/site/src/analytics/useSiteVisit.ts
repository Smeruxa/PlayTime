import { useEffect } from "react"
import { useLocation } from "react-router-dom"
import { getApiBase } from "../config/apiBase"

const COOKIE_NAME = "pt_site_visit_v1"
const TTL_SECONDS = 30 * 60
const pages: Record<string, string> = {
    "/": "landing",
    "/legal/terms": "terms",
    "/legal/privacy": "privacy",
    "/feedback": "feedback",
}

function browserSession(): string | null {
    try {
        const previous = document.cookie
            .split("; ")
            .find((part) => part.startsWith(`${COOKIE_NAME}=`))
            ?.slice(COOKIE_NAME.length + 1)
        const id =
            previous && /^[a-f0-9]{32}$/.test(previous)
                ? previous
                : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
                      byte.toString(16).padStart(2, "0")
                  ).join("")
        const path = import.meta.env.BASE_URL.replace(/\/$/, "") || "/playtime"
        document.cookie = `${COOKIE_NAME}=${id}; Max-Age=${TTL_SECONDS}; Path=${path}; SameSite=Strict${location.protocol === "https:" ? "; Secure" : ""}`
        return document.cookie.split("; ").includes(`${COOKIE_NAME}=${id}`) ? id : null
    } catch {
        return null
    }
}

export function useSiteVisit() {
    const { pathname } = useLocation()
    useEffect(() => {
        const page = pages[pathname.replace(/\/$/, "") || "/"]
        const privacy = navigator as Navigator & { globalPrivacyControl?: boolean }
        if (!page || navigator.doNotTrack === "1" || privacy.globalPrivacyControl) return
        let disposed = false
        let lastSent = 0
        const controllers = new Set<AbortController>()
        const ping = async () => {
            if (disposed || document.visibilityState !== "visible") return
            lastSent = Date.now()
            try {
                if (!navigator.locks) return
                const id = await navigator.locks.request("playtime-site-visit", () =>
                    browserSession()
                )
                if (!id || disposed) return
                const controller = new AbortController()
                controllers.add(controller)
                const timeout = window.setTimeout(() => controller.abort(), 5000)
                try {
                    await fetch(`${getApiBase()}/site-analytics/visit`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        credentials: "same-origin",
                        body: JSON.stringify({ sessionId: id, page }),
                        signal: controller.signal,
                    })
                } finally {
                    clearTimeout(timeout)
                    controllers.delete(controller)
                }
            } catch {
            }
        }
        const onVisible = () => {
            void ping()
        }
        const onActivity = () => {
            if (Date.now() - lastSent >= 60_000) void ping()
        }
        void ping()
        document.addEventListener("visibilitychange", onVisible)
        window.addEventListener("pointerdown", onActivity, { passive: true })
        window.addEventListener("keydown", onActivity)
        window.addEventListener("scroll", onActivity, { passive: true })
        return () => {
            disposed = true
            document.removeEventListener("visibilitychange", onVisible)
            window.removeEventListener("pointerdown", onActivity)
            window.removeEventListener("keydown", onActivity)
            window.removeEventListener("scroll", onActivity)
            controllers.forEach((controller) => controller.abort())
        }
    }, [pathname])
}
