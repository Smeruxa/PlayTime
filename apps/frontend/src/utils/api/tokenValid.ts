import { API_BASE } from "../../config"
import { AuthRequestError } from "./refreshSession"
import { withRequestDeadline } from "./requestDeadline"

export async function tokenValid(token: string) {
    return withRequestDeadline(async (signal) => {
        const res = await fetch(`${API_BASE}/auth/tokenValid`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
            signal
        })
        const body = await res.json().catch(() => ({}))
        signal.throwIfAborted()
        if (!res.ok) {
            throw new AuthRequestError(body.error || "Token validation failed", res.status)
        }
        return body
    })
}
