import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { checkAdminAccess, endAdminSession } from "../auth/adminLogin"
import { SITE_ACCESS_TOKEN_KEY, SITE_REFRESH_TOKEN_KEY } from "../auth/siteSession"
import { getApiBase } from "../config/apiBase"

const sessionEndedEvent = "playtime-admin-session-ended"

export function useAdminSession() {
    const navigate = useNavigate()
    const [ready, setReady] = useState(false)
    const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
    const [clientIp, setClientIp] = useState("")
    const [accessError, setAccessError] = useState<string | null>(null)
    const [logoutError, setLogoutError] = useState<string | null>(null)
    const [isLoggingOut, setIsLoggingOut] = useState(false)
    const authHeaders = useCallback((): Record<string, string> => ({ "X-PlayTime-Admin": "1" }), [])
    const logout = useCallback(async () => {
        if (isLoggingOut) return
        setIsLoggingOut(true)
        setLogoutError(null)
        try {
            await endAdminSession(getApiBase())
            window.dispatchEvent(new Event(sessionEndedEvent))
            navigate("/admin", { replace: true })
        } catch (error: unknown) {
            setLogoutError(error instanceof Error ? error.message : "Не удалось завершить сессию.")
        } finally {
            setIsLoggingOut(false)
        }
    }, [isLoggingOut, navigate])
    useEffect(() => {
        try {
            sessionStorage.removeItem(SITE_ACCESS_TOKEN_KEY)
            sessionStorage.removeItem(SITE_REFRESH_TOKEN_KEY)
        } catch {
        }
        const controller = new AbortController()
        const clearSession = () => {
            controller.abort()
            setIsAdmin(false)
            setClientIp("")
            setAccessError(null)
            setReady(true)
        }
        window.addEventListener(sessionEndedEvent, clearSession)
        void checkAdminAccess(getApiBase(), controller.signal)
            .then(({ clientIp: ip }) => {
                if (!controller.signal.aborted) {
                    setIsAdmin(true)
                    setClientIp(ip)
                }
            })
            .catch((error: unknown) => {
                if (!controller.signal.aborted) {
                    setIsAdmin(false)
                    setAccessError(
                        error instanceof Error ? error.message : "Не удалось проверить доступ."
                    )
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setReady(true)
            })
        return () => {
            controller.abort()
            window.removeEventListener(sessionEndedEvent, clearSession)
        }
    }, [])
    return { ready, isAdmin, clientIp, accessError, authHeaders, logout, logoutError, isLoggingOut }
}
