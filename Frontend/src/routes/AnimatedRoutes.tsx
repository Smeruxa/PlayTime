import { Routes, Route, useLocation, useNavigate } from "react-router-dom"
import { AnimatePresence } from "framer-motion"
import { login, tokenValid } from "../utils/api/api"
import { useSocket } from "../server/SocketContext"
import React, { useEffect, useState } from "react"
import Loading from "../components/Loading/Loading"
import PageTransition from "./PageTransition"
import Auth from "../pages/Auth/Auth"
import Registration from "../pages/Registration/Registration"
import Content from "../pages/Content/Content"
import Donate from "../pages/Donate/Donate"
import Talk from "../pages/Talk/Talk"
import Friends from "../pages/Friends/Friends"

const AnimatedRoutes: React.FC = () => {
    const location = useLocation()
    const navigate = useNavigate()
    const { token, setToken } = useSocket()
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const autoLogin = async () => {
            if (location.pathname === "/") {
                setLoading(false)
                return
            }

            const token = localStorage.getItem("token")
            const email = localStorage.getItem("email")
            const password = localStorage.getItem("password")

            let validToken = false
            if (token) {
                try {
                    const res = await tokenValid(token)
                    validToken = res.valid
                } catch {
                    validToken = false
                }
            }

            if (validToken) {
                console.log("Got valid token")
                setToken(token!)
            } else if (email && password) {
                try {
                    const res = await login(email, password)
                    if (res && res.token) {
                        console.log("Logined with email & password")
                        localStorage.setItem("token", res.token)
                        setToken(res.token)
                    } else {
                        localStorage.removeItem("email")
                        localStorage.removeItem("password")
                        navigate("/")
                    }
                } catch {
                    localStorage.removeItem("email")
                    localStorage.removeItem("password")
                    navigate("/")
                }
            } else {
                navigate("/")
            }

            setLoading(false)
        }

        autoLogin()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token])

    useEffect(() => { 
        const body = async () => {
            try {
                const email = localStorage.getItem("email")
                const password = localStorage.getItem("password")
                if (email && password && email !== "" && password !== "") {
                    const res = await login(email, password)
                    if (res && res.token) {
                        setToken(res.token)
                        navigate("/content")
                    }
                }
            } finally {
                setLoading(false)
            }
        }
        body()
    }, [])

    if (loading) return <Loading />

    return (
        <AnimatePresence mode="wait">
            <Routes location={location} key={location.pathname}>
                <Route path="/" element={<PageTransition><Auth /></PageTransition>} />
                <Route path="/content" element={<PageTransition><Content /></PageTransition>} />
                <Route path="/registration" element={<PageTransition><Registration /></PageTransition>} />
                <Route path="/donate" element={<PageTransition><Donate /></PageTransition>} />
                <Route path="/talk" element={<PageTransition><Talk /></PageTransition>} />
                <Route path="/friends" element={<PageTransition><Friends /></PageTransition>} />
            </Routes>
        </AnimatePresence>
    )
}

export default AnimatedRoutes