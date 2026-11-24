import { API_BASE } from "../../config"
import { queueSessionRevocation, sendQueuedRevocation } from "./revocationOutbox"
import { withRequestDeadline } from "./requestDeadline"

export async function revokeSession(token?: string | null, refreshToken?: string | null): Promise<void> {
    const proof = refreshToken ? queueSessionRevocation(refreshToken) : null
    if (proof) {
        await sendQueuedRevocation(proof, true)
        return
    }
    if (!token) return
    try {
        await withRequestDeadline(async (signal) => {
            const response = await fetch(`${API_BASE}/auth/revoke`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token }),
                signal
            })
            if (!response.ok) throw new Error("Session revocation was not acknowledged")
        })
    } catch {
    }
}
