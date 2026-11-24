import { SOCKET_URL } from "./socketUrl"

export const API_BASE = (() => {
    const raw = process.env.REACT_APP_API_BASE?.trim()
    if (process.env.REACT_APP_WEB_BUILD === "true") return new URL(raw || "/playtime", window.location.origin).href
    if (raw) return raw.replace(/\/$/, "")
    return `${SOCKET_URL}/playtime`
})()
