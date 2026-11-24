import { tokenValid } from "./tokenValid"
import { AuthRequestError, isFatalAuthError, refreshSession, sameAccessSession } from "./refreshSession"
import { revokeSession } from "./revokeSession"
export async function restoreStoredSession(): Promise<string | null> {
    const token = localStorage.getItem("token"),
        refresh = localStorage.getItem("refreshToken")
    const isCurrentSession = () =>
        localStorage.getItem("token") === token && localStorage.getItem("refreshToken") === refresh
    if (token) {
        try {
            const result = await tokenValid(token)
            if (!isCurrentSession()) return localStorage.getItem("token")
            if (!result.valid) throw new AuthRequestError("Invalid session", 401)
            return token
        } catch (error) {
            if (!isCurrentSession()) return localStorage.getItem("token")
            if (!refresh) {
                if (!isFatalAuthError(error)) throw error
                localStorage.removeItem("token")
                return null
            }
        }
    }
    if (!refresh) return null
    try {
        const result = await refreshSession(refresh)
        if (!isCurrentSession()) {
            if (
                localStorage.getItem("token") === result.token &&
                localStorage.getItem("refreshToken") === result.refreshToken
            )
                return result.token
            const latestAccess = localStorage.getItem("token")
            if (latestAccess && localStorage.getItem("refreshToken") && sameAccessSession(result.token, latestAccess))
                return latestAccess
            void revokeSession(result.token, result.refreshToken)
            return localStorage.getItem("token")
        }
        if (!result.persisted) {
            localStorage.setItem("token", result.token)
            localStorage.setItem("refreshToken", result.refreshToken)
        }
        return result.token
    } catch (error) {
        if (!isCurrentSession()) return localStorage.getItem("token")
        if (!isFatalAuthError(error)) throw error
        localStorage.removeItem("token")
        localStorage.removeItem("refreshToken")
        return null
    }
}
