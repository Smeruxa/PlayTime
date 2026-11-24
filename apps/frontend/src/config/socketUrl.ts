export const SOCKET_URL = (() => {
    const raw = process.env.REACT_APP_SOCKET_URL?.trim()
    if (raw) return raw.replace(/\/$/, "")
    if (process.env.REACT_APP_WEB_BUILD === "true") return window.location.origin
    if (process.env.NODE_ENV !== "production") return "http://localhost:1501"
    return "https://smeruxa.ru"
})()
