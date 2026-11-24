import { verifyUserAccessToken, type AccessTokenPayload } from "../../auth"

export const LOGIN_THROTTLED = "Слишком много неудачных попыток входа. Повторите позже."
export const REGISTRATION_CONFLICT = "Никнейм или почта уже используются. Укажите другие данные."
export const TOKEN_TOO_LARGE = 12_000

export type AccountRow = {
    id: number
    username: string
    email: string
    is_guest?: boolean
    guest_registration_pending?: boolean
}

export function accountView(user: AccountRow) {
    return {
        id: user.id,
        username: user.username,
        email: user.is_guest && !user.guest_registration_pending ? null : user.email,
        isGuest: user.is_guest === true,
        registrationPending: user.guest_registration_pending === true
    }
}

export function validUsername(username: unknown): username is string {
    return (
        typeof username === "string" &&
        username.length >= 3 &&
        username.length <= 15 &&
        username !== "Выберите пользователя" &&
        !/[\s\u200B-\u200D\uFEFF]/.test(username)
    )
}

export function isReasonableEmail(email: string): boolean {
    if (email.length > 254 || /\s/.test(email)) return false
    const at = email.indexOf("@")
    if (at < 1 || at !== email.lastIndexOf("@")) return false
    const domain = email.slice(at + 1)
    if (domain.length < 2) return false
    if (domain === "localhost" || domain.endsWith(".localhost")) return true
    return domain.includes(".") && domain.length >= 3
}

export async function getBearerSession(header: unknown): Promise<AccessTokenPayload | null> {
    const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7).trim() : ""
    if (!token || token.length > TOKEN_TOO_LARGE) return null
    try {
        return await verifyUserAccessToken(token)
    } catch {
        return null
    }
}
