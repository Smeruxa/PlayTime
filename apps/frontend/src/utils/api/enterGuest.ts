import { API_BASE } from "../../config"
import { withRequestDeadline } from "./requestDeadline"
import { guestRequestKey, publishGuestRequest, retireGuestRequest } from "./refreshHandoff"

const PENDING_GUEST = "playtime:pending-guest"
type GuestAttempt = { username: string; requestKey: string; retired?: boolean }
function savedGuestAttempt(): GuestAttempt | null {
    try {
        const attempt = JSON.parse(localStorage.getItem(PENDING_GUEST) || "null")
        return attempt && typeof attempt.username === "string" && /^[a-f0-9]{64}$/.test(attempt.requestKey)
            ? attempt
            : null
    } catch {
        return null
    }
}

export function pendingGuest(): GuestAttempt | null {
    const attempt = savedGuestAttempt()
    return attempt && !attempt.retired ? attempt : null
}

function markRetired(attempt: GuestAttempt): void {
    if (savedGuestAttempt()?.requestKey === attempt.requestKey) {
        try {
            localStorage.setItem(PENDING_GUEST, JSON.stringify({ ...attempt, retired: true }))
        } catch {
        }
    }
}

function clearAttempt(attempt: GuestAttempt): void {
    if (savedGuestAttempt()?.requestKey === attempt.requestKey) localStorage.removeItem(PENDING_GUEST)
}

async function retireAttempt(attempt: GuestAttempt): Promise<void> {
    markRetired(attempt)
    await retireGuestRequest(attempt.username, attempt.requestKey)
    clearAttempt(attempt)
}

export async function abandonPendingGuest(): Promise<void> {
    const attempt = savedGuestAttempt()
    if (attempt) await retireAttempt(attempt)
}

export async function enterGuest(username: string, signal?: AbortSignal): Promise<string> {
    const previous = pendingGuest()
    const initialAccess = localStorage.getItem("token"),
        initialRefresh = localStorage.getItem("refreshToken")
    return withRequestDeadline(
        async (requestSignal) => {
            const abandoned = savedGuestAttempt()
            if (abandoned && (abandoned.retired || abandoned.username !== username)) await retireAttempt(abandoned)
            requestSignal.throwIfAborted()
            const requestKey = await guestRequestKey(
                username,
                previous?.username === username ? previous.requestKey : undefined
            )
            requestSignal.throwIfAborted()
            const attempt = { username, requestKey }
            localStorage.setItem(PENDING_GUEST, JSON.stringify(attempt))
            const response = await fetch(`${API_BASE}/auth/guest`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-PlayTime-Device": "PlayTime Web" },
                body: JSON.stringify(attempt),
                signal: requestSignal
            })
            const body = await response.json()
            requestSignal.throwIfAborted()
            if (!response.ok) throw new Error(body.error || "Не удалось войти. Попробуйте ещё раз.")
            if (
                typeof body.token !== "string" ||
                !body.token ||
                typeof body.refreshToken !== "string" ||
                !body.refreshToken
            )
                throw new Error("Не удалось сохранить сессию. Попробуйте ещё раз.")
            await publishGuestRequest(
                username,
                requestKey,
                () => {
                    requestSignal.throwIfAborted()
                    if (
                        localStorage.getItem("token") !== initialAccess ||
                        localStorage.getItem("refreshToken") !== initialRefresh
                    )
                        throw new Error("В другой вкладке выполнен вход. Обновите страницу, чтобы продолжить.")
                    localStorage.setItem("refreshToken", body.refreshToken)
                    localStorage.setItem("token", body.token)
                    markRetired(attempt)
                },
                () => clearAttempt(attempt)
            )
            return body.token as string
        },
        undefined,
        signal
    )
}
