import { API_BASE } from "../../config"
import { readJwtExpUnix } from "../jwtPayload"
import { revokeSession } from "./revokeSession"
import { rememberConsumedRefresh, wasRefreshConsumed, refreshRequestKey } from "./refreshHandoff"
import { AUTH_LOCK_TIMEOUT_MS, RequestTimeoutError, withRequestDeadline } from "./requestDeadline"

export type RefreshResponse = {
    token: string
    refreshToken: string
    expiresIn: number
    persisted?: boolean
    user?: { id: number; username: string; email: string | null; isGuest?: boolean; registrationPending?: boolean }
}

export class AuthRequestError extends Error {
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message)
    }
}
export const isFatalAuthError = (error: unknown) =>
    error instanceof AuthRequestError && (error.status === 401 || error.status === 403)
const pending = new Map<string, Promise<RefreshResponse>>()

export function accessSessionKey(token: string | null): string | null {
    if (!token) return null
    try {
        const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")
        const data = JSON.parse(atob(part + "=".repeat((4 - (part.length % 4)) % 4))) as { id?: unknown; sid?: unknown }
        return typeof data.id === "number" &&
            Number.isSafeInteger(data.id) &&
            typeof data.sid === "string" &&
            data.sid.length > 0
            ? `${data.id}:${data.sid}`
            : null
    } catch {
        return null
    }
}

export function sameAccessSession(first: string | null, second: string | null): boolean {
    if (first === second) return true
    const key = accessSessionKey(first)
    return key != null && key === accessSessionKey(second)
}

async function requestRefresh(refreshToken: string, signal: AbortSignal): Promise<RefreshResponse> {
    const requestKey = await refreshRequestKey(refreshToken)
    signal.throwIfAborted()
    const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken, requestKey }),
        signal
    })
    const body = await res.json().catch(() => ({}))
    signal.throwIfAborted()
    if (!res.ok) {
        throw new AuthRequestError(body.error || "Сервер временно недоступен", res.status)
    }
    if (typeof body.token !== "string" || !body.token || typeof body.refreshToken !== "string" || !body.refreshToken)
        throw new AuthRequestError("Сервер вернул неполную сессию", 503)
    return body as RefreshResponse
}

async function refreshAcrossTabs(refreshToken: string): Promise<RefreshResponse> {
    const initialAccess = localStorage.getItem("token")
    const waiting = new AbortController()
    const timer = setTimeout(() => waiting.abort(), AUTH_LOCK_TIMEOUT_MS)
    try {
        return await navigator.locks.request("playtime:auth-refresh", { signal: waiting.signal }, async () => {
            clearTimeout(timer)
            return withRequestDeadline(async (signal) => {
                if (await wasRefreshConsumed(refreshToken)) await waitForStoredRotation(refreshToken, initialAccess)
                const storedAccess = localStorage.getItem("token")
                const storedRefresh = localStorage.getItem("refreshToken")
                let tokenToRefresh = refreshToken
                if (storedRefresh !== refreshToken) {
                    if (!storedAccess || !storedRefresh || !sameAccessSession(initialAccess, storedAccess))
                        throw new AuthRequestError("Сессия изменилась в другой вкладке", 409)
                    const expiresIn = (readJwtExpUnix(storedAccess) ?? 0) - Date.now() / 1000
                    if (expiresIn > 30)
                        return { token: storedAccess, refreshToken: storedRefresh, expiresIn, persisted: true }
                    tokenToRefresh = storedRefresh
                }
                if (!storedRefresh) throw new AuthRequestError("Сессия завершена в другой вкладке", 409)
                if (tokenToRefresh !== refreshToken && (await wasRefreshConsumed(tokenToRefresh)))
                    throw new AuthRequestError("Сессия обновляется в другой вкладке. Повторите подключение.", 409)
                const response = await requestRefresh(tokenToRefresh, signal)
                signal.throwIfAborted()
                if (
                    localStorage.getItem("token") !== storedAccess ||
                    localStorage.getItem("refreshToken") !== storedRefresh
                ) {
                    void revokeSession(response.token, response.refreshToken)
                    throw new AuthRequestError("Сессия изменилась в другой вкладке", 409)
                }
                localStorage.setItem("refreshToken", response.refreshToken)
                localStorage.setItem("token", response.token)
                try {
                    await rememberConsumedRefresh(tokenToRefresh)
                } catch {
                }
                return { ...response, persisted: true }
            })
        })
    } catch (error) {
        if (waiting.signal.aborted) throw new RequestTimeoutError()
        throw error
    } finally {
        clearTimeout(timer)
    }
}

function waitForStoredRotation(consumed: string, originalAccess: string | null): Promise<void> {
    return new Promise((resolve, reject) => {
        const finish = (error?: Error) => {
            window.removeEventListener("storage", changed)
            clearTimeout(timeout)
            if (error) reject(error)
            else resolve()
        }
        const inspect = () => {
            const access = localStorage.getItem("token"),
                refresh = localStorage.getItem("refreshToken")
            if (!access && !refresh) return finish(new AuthRequestError("Сессия завершена в другой вкладке", 409))
            if (refresh === consumed || !access || !refresh) return
            if (!sameAccessSession(originalAccess, access))
                return finish(new AuthRequestError("Сессия изменилась в другой вкладке", 409))
            finish()
        }
        const changed = (event: StorageEvent) => {
            if (
                (!event.storageArea || event.storageArea === localStorage) &&
                (event.key == null || event.key === "token" || event.key === "refreshToken")
            )
                inspect()
        }
        const timeout = setTimeout(
            () => finish(new AuthRequestError("Не удалось синхронизировать вкладки. Повторите подключение.", 409)),
            5000
        )
        window.addEventListener("storage", changed)
        inspect()
    })
}

export function refreshSession(refreshToken: string): Promise<RefreshResponse> {
    const existing = pending.get(refreshToken)
    if (existing) return existing
    const request = (
        typeof navigator !== "undefined" && typeof navigator.locks?.request === "function"
            ? refreshAcrossTabs(refreshToken)
            : withRequestDeadline((signal) => requestRefresh(refreshToken, signal))
    ).finally(() => {
        pending.delete(refreshToken)
    })
    pending.set(refreshToken, request)
    return request
}
