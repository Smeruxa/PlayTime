export function getApiBase(): string {
    const raw = import.meta.env.VITE_API_BASE
    if (typeof raw === "string" && raw.trim()) return raw.replace(/\/$/, "")
    return "/playtime"
}
