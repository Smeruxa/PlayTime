export function readJwtExpUnix(token: string | null): number | null {
    if (!token || typeof token !== "string") return null
    const parts = token.split(".")
    if (parts.length < 2) return null
    try {
        const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/")
        const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4)
        const o = JSON.parse(atob(padded)) as { exp?: unknown }
        return typeof o.exp === "number" && Number.isFinite(o.exp) ? o.exp : null
    } catch {
        return null
    }
}

export function readJwtPayload(token: string | null): { id?: number; username?: string } | null {
    if (!token || typeof token !== "string") return null
    const parts = token.split(".")
    if (parts.length < 2) return null
    try {
        const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/")
        const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4)
        const json = atob(padded)
        const o = JSON.parse(json) as { id?: unknown; username?: unknown }
        const id = typeof o.id === "number" && Number.isFinite(o.id) ? o.id : undefined
        const username = typeof o.username === "string" && o.username.length > 0 ? o.username : undefined
        if (id == null && username == null) return null
        return { id, username }
    } catch {
        return null
    }
}
