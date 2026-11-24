import { useRevocationOutbox } from "../socket/useRevocationOutbox"
import { isFatalAuthError, sameAccessSession } from "../../utils/api/refreshSession"
import { ConnectionBanner } from "./ConnectionBanner"
import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { refreshSession, revokeSession } from "../../utils/api"
import { abandonPendingGuest } from "../../utils/api/enterGuest"
import { readJwtExpUnix } from "../../utils/jwtPayload"
import { useSocketConnection } from "../socket/useSocketConnection"
import { useSocketMyName } from "../socket/useSocketMyName"
import { useLastPreviewsBootstrap } from "../socket/useLastPreviewsBootstrap"
import { usePresencePolling } from "../socket/usePresencePolling"
import { useMessagePreviewSideEffects } from "../socket/useMessagePreviewSideEffects"
import { useWindowFocused } from "../../hooks/useWindowFocused"
import { useEnsureDmKeys } from "../../features/chat/hooks/useEnsureDmKeys"
import { disposeMessageOutbox } from "../../features/chat/messageOutbox"
import type { LastPreview } from "../socket/types"
import type { CallProps } from "../../types"
import type { SubscriptionMeResponse } from "../../types/subscription"
import { API_BASE } from "../../config"
import { PlanChangedModal } from "../../components/PlanChangedModal/PlanChangedModal"
import { PeerKeyNotice } from "../../features/chat/components/PeerKeyNotice"
import { SocketContext, SessionContext, CallContext, PresenceContext, ChatPreviewsContext } from "./context"
import type { CurrentChat } from "./types"

export const SocketProvider = ({ children }: { children: React.ReactNode }) => {
    useRevocationOutbox()
    const [token, setToken] = useState<string | null>(null)
    const currentToken = useRef(token)
    currentToken.current = token
    const [planSlug, setPlanSlug] = useState<string | null>(null)
    const [planLimits, setPlanLimits] = useState<SubscriptionMeResponse["limits"] | null>(null)
    const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const socket = useSocketConnection(token)
    useEffect(() => {
        if (!socket) return
        return () => disposeMessageOutbox(socket)
    }, [socket])
    const { myName, setMyName, myUserId, setMyUserId } = useSocketMyName(socket, token)
    const encryptionState = useEnsureDmKeys(socket, myUserId)
    const [activeCall, setActiveCall] = useState<CallProps | null>(null)
    useEffect(() => {
        window.electronAPI?.setCallActive?.(activeCall != null)
    }, [activeCall])
    const [onlineUserIds, setOnlineUserIds] = useState<Set<number>>(new Set())
    const [lastPreviews, setLastPreviews] = useState<Record<string, LastPreview>>({})
    const [roomUnreadById, setRoomUnreadById] = useState<Record<number, number>>({})
    const [dmUnreadByUsername, setDmUnreadByUsername] = useState<Record<string, number>>({})
    const [currentChat, setCurrentChat] = useState<CurrentChat>(null)
    const navigate = useNavigate()
    const authRecoverLock = useRef(false)
    const sessionGeneration = useRef(0)
    const socketMountGen = useRef(0)
    const [forcedPlanChangeSlug, setForcedPlanChangeSlug] = useState<string | null>(null)
    const planChangeOverlayLockRef = useRef(false)

    useEffect(
        () => () => {
            sessionGeneration.current += 1
        },
        []
    )

    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            if (event.storageArea && event.storageArea !== localStorage) return
            if (event.key !== null && event.key !== "token" && event.key !== "refreshToken") return
            const nextToken = localStorage.getItem("token")
            const nextRefresh = localStorage.getItem("refreshToken")
            if ((!nextToken && nextRefresh) || (nextToken && !nextRefresh)) return
            const previousToken = currentToken.current
            if (nextToken === previousToken) return
            const changedSession = !sameAccessSession(previousToken, nextToken)
            if (changedSession) {
                sessionGeneration.current += 1
                setActiveCall(null)
                setCurrentChat(null)
                setLastPreviews({})
                setRoomUnreadById({})
                setDmUnreadByUsername({})
                setOnlineUserIds(new Set())
                setPlanSlug(null)
                setPlanLimits(null)
                setForcedPlanChangeSlug(null)
            }
            currentToken.current = nextToken
            setToken(nextToken)
            if (!nextToken) navigate("/", { replace: true })
            else if (changedSession) navigate("/content", { replace: true })
        }
        window.addEventListener("storage", onStorage)
        return () => window.removeEventListener("storage", onStorage)
    }, [navigate])

    const refreshAccessToken = useCallback(async (): Promise<boolean> => {
        if (authRecoverLock.current) return false
        const rt = localStorage.getItem("refreshToken")
        if (!rt) return false
        const generation = sessionGeneration.current
        const isCurrentSession = () =>
            generation === sessionGeneration.current && localStorage.getItem("refreshToken") === rt
        authRecoverLock.current = true
        try {
            const r = await refreshSession(rt)
            const sharedResultIsCurrent =
                generation === sessionGeneration.current &&
                localStorage.getItem("token") === r.token &&
                localStorage.getItem("refreshToken") === r.refreshToken
            if (!isCurrentSession() && !sharedResultIsCurrent) {
                const latestAccess = localStorage.getItem("token")
                const latestRefresh = localStorage.getItem("refreshToken")
                if (
                    generation === sessionGeneration.current &&
                    latestAccess &&
                    latestRefresh &&
                    sameAccessSession(r.token, latestAccess)
                ) {
                    setToken(latestAccess)
                    return true
                }
                void revokeSession(r.token, r.refreshToken)
                return false
            }
            if (!r.persisted) {
                localStorage.setItem("token", r.token)
                localStorage.setItem("refreshToken", r.refreshToken)
            }
            setToken(r.token)
            return true
        } catch (e) {
            if (!isCurrentSession()) return false
            if (!isFatalAuthError(e)) {
                return false
            }
            localStorage.removeItem("token")
            localStorage.removeItem("refreshToken")
            setToken(null)
            navigate("/")
            return false
        } finally {
            authRecoverLock.current = false
        }
    }, [setToken, navigate])

    useEffect(() => {
        if (!token) {
            setPlanSlug(null)
            setPlanLimits(null)
            return
        }
        const ac = new AbortController()
        ;(async () => {
            try {
                const res = await fetch(`${API_BASE}/subscription/me`, {
                    headers: { Authorization: `Bearer ${token}` },
                    signal: ac.signal
                })
                if (!res.ok) {
                    setPlanSlug(null)
                    setPlanLimits(null)
                    return
                }
                const body = (await res.json()) as SubscriptionMeResponse
                if (typeof body?.planSlug === "string" && body.limits) {
                    setPlanSlug(body.planSlug)
                    setPlanLimits(body.limits)
                } else {
                    setPlanSlug(null)
                    setPlanLimits(null)
                }
            } catch {
                if (!ac.signal.aborted) {
                    setPlanSlug(null)
                    setPlanLimits(null)
                }
            }
        })()
        return () => ac.abort()
    }, [token])

    useEffect(() => {
        if (!socket) return
        const onSubscriptionPlanChanged = (data: { planSlug?: string }) => {
            try {
                window.dispatchEvent(new Event("playtime:refresh-friend-avatars"))
            } catch {
            }
            if (planChangeOverlayLockRef.current) return
            planChangeOverlayLockRef.current = true
            const slug = typeof data?.planSlug === "string" ? data.planSlug : "free"
            setForcedPlanChangeSlug(slug)
            try {
                window.windowControls?.focus?.()
            } catch {
            }
        }
        socket.on("subscription:planChanged", onSubscriptionPlanChanged)
        return () => {
            socket.off("subscription:planChanged", onSubscriptionPlanChanged)
        }
    }, [socket])

    useEffect(() => {
        if (!socket) return
        const mountId = ++socketMountGen.current

        const bumpAfterSleep = async () => {
            const t = localStorage.getItem("token")
            const rt = localStorage.getItem("refreshToken")
            if (!rt || !t) return
            const exp = readJwtExpUnix(t)
            const nowSec = Date.now() / 1000
            if (!exp || exp <= nowSec + 120) {
                await refreshAccessToken()
                return
            }
            if (mountId !== socketMountGen.current) return
            if (!socket.connected) socket.connect()
        }

        const onVisibility = () => {
            if (document.visibilityState === "visible") void bumpAfterSleep()
        }

        const onOnline = () => {
            void bumpAfterSleep()
        }

        const onConnectError = (err: Error) => {
            const m = (err?.message ?? "").toLowerCase()
            const t = localStorage.getItem("token")
            const exp = readJwtExpUnix(t)
            const nowSec = Date.now() / 1000
            const accessLikelyDead = !exp || exp <= nowSec + 30
            const authMsg =
                m.includes("auth") ||
                m.includes("unauthor") ||
                m.includes("jwt") ||
                m.includes("forbidden") ||
                m.includes("invalid")
            if (authMsg || accessLikelyDead) void refreshAccessToken()
        }
        const onSessionRevoked = () => {
            if (!sameAccessSession(token, currentToken.current)) return
            const stored = localStorage.getItem("token")
            if (stored && !sameAccessSession(token, stored)) return
            sessionGeneration.current += 1
            localStorage.removeItem("token")
            localStorage.removeItem("refreshToken")
            setToken(null)
            navigate("/")
        }
        const onSessionExpired = () => {
            void refreshAccessToken()
        }

        document.addEventListener("visibilitychange", onVisibility)
        window.addEventListener("online", onOnline)
        socket.on("connect_error", onConnectError)
        socket.on("session:revoked", onSessionRevoked)
        socket.on("session:expired", onSessionExpired)
        return () => {
            document.removeEventListener("visibilitychange", onVisibility)
            window.removeEventListener("online", onOnline)
            socket.off("connect_error", onConnectError)
            socket.off("session:revoked", onSessionRevoked)
            socket.off("session:expired", onSessionExpired)
        }
    }, [socket, token, refreshAccessToken, navigate])

    const windowFocusedRef = useWindowFocused()
    useLastPreviewsBootstrap(socket, myName, myUserId, setLastPreviews, setRoomUnreadById, setDmUnreadByUsername)
    usePresencePolling(socket, setOnlineUserIds)
    useMessagePreviewSideEffects(
        socket,
        myName,
        myUserId,
        currentChat,
        setLastPreviews,
        setRoomUnreadById,
        setDmUnreadByUsername,
        windowFocusedRef
    )

    useEffect(() => {
        if (!currentChat?.isRoom) return
        setRoomUnreadById((prev) => ({ ...prev, [currentChat.id]: 0 }))
    }, [currentChat?.id, currentChat?.isRoom])

    useEffect(() => {
        if (currentChat?.isRoom) return
        const peer = currentChat?.id
        if (!peer) return
        setDmUnreadByUsername((prev) => ({ ...prev, [peer]: 0 }))
    }, [currentChat?.id, currentChat?.isRoom])

    useEffect(() => {
        if (!socket) {
            setActiveCall(null)
            return
        }
        const onDisconnect = (reason: string) => {
            if (reason === "io server disconnect" || reason === "io client disconnect") setActiveCall(null)
        }
        socket.on("disconnect", onDisconnect)
        return () => {
            socket.off("disconnect", onDisconnect)
        }
    }, [socket])

    useEffect(() => {
        if (refreshTimerRef.current) {
            clearTimeout(refreshTimerRef.current)
            refreshTimerRef.current = null
        }
        if (!token) return
        const rt = localStorage.getItem("refreshToken")
        if (!rt) return
        const exp = readJwtExpUnix(token)
        if (!exp) return
        const msUntilRefresh = Math.max(5_000, exp * 1000 - Date.now() - 90_000)
        let cancelled = false
        const attempt = async () => {
            const ok = await refreshAccessToken()
            if (!ok && !cancelled && localStorage.getItem("refreshToken"))
                refreshTimerRef.current = setTimeout(() => void attempt(), 15_000)
        }
        refreshTimerRef.current = setTimeout(() => void attempt(), msUntilRefresh)
        return () => {
            cancelled = true
            if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
        }
    }, [token, refreshAccessToken])

    const logout = useCallback(() => {
        sessionGeneration.current += 1
        void abandonPendingGuest().catch(() => {})
        if (socket && activeCall) {
            if (activeCall.isParty) {
                socket.emit("room:leave", { roomId: activeCall.roomId })
            } else {
                socket.emit("call:end", { roomId: activeCall.roomId, ownershipRevision: activeCall.ownershipRevision })
            }
            setActiveCall(null)
        }
        const t = localStorage.getItem("token")
        const rt = localStorage.getItem("refreshToken")
        void revokeSession(t, rt)
        localStorage.removeItem("email")
        localStorage.removeItem("password")
        localStorage.removeItem("token")
        localStorage.removeItem("refreshToken")
        setToken(null)
        navigate("/")
    }, [socket, activeCall, navigate])
    const exposedSocket = encryptionState && !encryptionState.ready && myUserId != null ? null : socket
    const sessionValue = useMemo(
        () => ({
            socket: exposedSocket,
            token,
            planSlug,
            planLimits,
            myName,
            myUserId,
            setToken,
            logout,
            setMyName,
            setMyUserId,
            currentChat,
            setCurrentChat
        }),
        [exposedSocket, token, planSlug, planLimits, myName, myUserId, logout, setMyName, setMyUserId, currentChat]
    )
    const callValue = useMemo(() => ({ activeCall, setActiveCall }), [activeCall])
    const previewValue = useMemo(
        () => ({ lastPreviews, roomUnreadById, dmUnreadByUsername }),
        [lastPreviews, roomUnreadById, dmUnreadByUsername]
    )
    const legacyValue = useMemo(
        () => ({ ...sessionValue, ...callValue, ...previewValue, onlineUserIds }),
        [sessionValue, callValue, previewValue, onlineUserIds]
    )

    return (
        <>
            <SessionContext.Provider value={sessionValue}>
                <CallContext.Provider value={callValue}>
                    <PresenceContext.Provider value={onlineUserIds}>
                        <ChatPreviewsContext.Provider value={previewValue}>
                            <SocketContext.Provider value={legacyValue}>
                                <ConnectionBanner socket={socket} authenticated={!!token} />
                                <PeerKeyNotice />
                                {children}
                            </SocketContext.Provider>
                        </ChatPreviewsContext.Provider>
                    </PresenceContext.Provider>
                </CallContext.Provider>
            </SessionContext.Provider>
            {forcedPlanChangeSlug != null ? <PlanChangedModal planSlug={forcedPlanChangeSlug} /> : null}
        </>
    )
}
