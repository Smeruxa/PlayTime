import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { login } from "../../utils/api"
import { useSessionSocket } from "../../server/socketContext"
import { EmailVerificationRequired } from "../../utils/api/login"
import { abandonPendingGuest } from "../../utils/api/enterGuest"

export function useAuthForm() {
    const navigate = useNavigate()
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)
    const { setToken } = useSessionSocket()

    const handleLogin = async () => {
        setLoading(true)
        setError("")
        try {
            if (!password || password.length > 50 || !email || email.length > 254) {
                setError("Введите почту и пароль")
                return
            }
            const res = await login(email, password)
            if (res && res.token) {
                void abandonPendingGuest().catch(() => {})
                localStorage.setItem("token", res.token)
                if (res.refreshToken) localStorage.setItem("refreshToken", res.refreshToken)
                else localStorage.removeItem("refreshToken")
                localStorage.removeItem("email")
                localStorage.removeItem("password")
                setToken(res.token)
                navigate("/content")
            } else {
                localStorage.removeItem("email")
                localStorage.removeItem("password")
                localStorage.removeItem("token")
            }
        } catch (err: unknown) {
            if (err instanceof EmailVerificationRequired) { navigate(`/verify-email?email=${encodeURIComponent(email.trim().toLowerCase())}`); return }
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setLoading(false)
        }
    }

    return {
        setEmail,
        setPassword,
        error,
        loading,
        handleLogin,
        navigate
    }
}
