import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom"
import { AnimatePresence, motion } from "framer-motion"
import { restoreStoredSession } from "../utils/api/restoreStoredSession"
import { accessSessionKey } from "../utils/api/refreshSession"
import { pendingGuest } from "../utils/api/enterGuest"
import { useSessionSocket } from "../server/socketContext"
import React, { useState, lazy, Suspense } from "react"
import Loading from "../components/Loading/Loading"
import { Button } from "../ui"
const Auth = lazy(() => import("../pages/Auth"))
const Registration = lazy(() => import("../pages/Registration"))
const Content = lazy(() => import("../pages/Content"))
const TalkPage = lazy(() => import("../pages/Talk"))
const Friends = lazy(() => import("../pages/Friends"))
const Profile = lazy(() => import("../pages/Profile"))
const CreateRoom = lazy(() => import("../pages/CreateRoom"))
const MainLayout = lazy(() => import("../pages/MainLayout"))

const EmailVerificationPage = lazy(() => import("../pages/Auth/EmailVerificationPage"))
const WelcomePage = lazy(() => import("../pages/Auth/WelcomePage"))
const GuestPage = lazy(() => import("../pages/Auth/GuestPage"))
const CompleteAccountPage = lazy(() => import("../pages/Auth/CompleteAccountPage"))

const AnimatedRoutes: React.FC = () => {
    const location = useLocation()
    const navigate = useNavigate()
    const { token, setToken } = useSessionSocket()
    const initialPath = React.useRef(location.pathname)
    const isWeb = !window.electronAPI
    const [loading, setLoading] = useState(true)
    const [connectionError, setConnectionError] = useState(false)
    const [attempt, setAttempt] = useState(0)

    const navigateRef = React.useRef(navigate)
    navigateRef.current = navigate
    const setTokenRef = React.useRef(setToken)
    setTokenRef.current = setToken

    React.useEffect(() => {
        let cancelled = false
        setLoading(true)
        setConnectionError(false)
        localStorage.removeItem("email")
        localStorage.removeItem("password")

        const autoLogin = async () => {
            try {
                const sessionToken = await restoreStoredSession()
                if (cancelled) return
                if (sessionToken) {
                    setTokenRef.current(sessionToken)
                    if (["/", "/login", "/guest", "/registration"].includes(initialPath.current))
                        navigateRef.current("/content", { replace: true })
                } else if (isWeb && initialPath.current === "/" && pendingGuest())
                    navigateRef.current("/guest", { replace: true })
                else if (!["/", "/login", "/guest", "/registration", "/verify-email"].includes(initialPath.current))
                    navigateRef.current("/", { replace: true })
                setLoading(false)
            } catch {
                if (!cancelled) {
                    setLoading(false)
                    setConnectionError(true)
                }
            }
        }

        autoLogin()
        return () => {
            cancelled = true
        }
    }, [attempt, isWeb])

    if (loading) return <Loading />
    if (connectionError)
        return (
            <div role="status" style={{ margin: "auto", display: "grid", gap: 16, textAlign: "center" }}>
                <p>Не удалось соединиться с сервером. Сессия сохранена.</p>
                <Button onClick={() => setAttempt((value) => value + 1)}>Повторить подключение</Button>
            </div>
        )

    const pageTransition = {
        initial: { opacity: 0.6 },
        animate: { opacity: 1 },
        exit: { opacity: 0.6 },
        transition: { duration: 0.12, ease: [0.4, 0, 0.2, 1] as const }
    }

    const isMainLayout = ["/content", "/friends", "/profile", "/createRoom"].includes(location.pathname)
    const layoutKey = isMainLayout ? "main" : location.pathname

    return (
        <AnimatePresence mode="wait">
            <motion.div
                key={layoutKey}
                {...pageTransition}
                style={{
                    width: "100%",
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    flexDirection: "column"
                }}
            >
                <Suspense fallback={<Loading />}>
                    <Routes location={location}>
                        <Route path="/" element={isWeb ? <WelcomePage /> : <Auth />} />
                        <Route path="/login" element={<Auth />} />
                        <Route path="/guest" element={token ? <Navigate to="/content" replace /> : <GuestPage />} />
                        <Route
                            path="/complete-account"
                            element={token ? <CompleteAccountPage /> : <Navigate to="/" replace />}
                        />
                        <Route path="/registration" element={<Registration />} />
                        <Route path="/verify-email" element={<EmailVerificationPage />} />
                        <Route path="/talk" element={token ? <TalkPage /> : <Navigate to="/" replace />} />
                        <Route
                            element={
                                token ? (
                                    <MainLayout key={accessSessionKey(token) ?? token} />
                                ) : (
                                    <Navigate to="/" replace />
                                )
                            }
                        >
                            <Route path="content" element={<Content />} />
                            <Route path="friends" element={<Friends />} />
                            <Route path="profile" element={<Profile />} />
                            <Route path="createRoom" element={<CreateRoom />} />
                        </Route>
                        <Route path="*" element={<Navigate to={token ? "/content" : "/"} replace />} />
                    </Routes>
                </Suspense>
            </motion.div>
        </AnimatePresence>
    )
}

export default AnimatedRoutes
