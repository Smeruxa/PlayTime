import { useNavigate } from "react-router-dom"
import { useState, useEffect } from "react"
import { passwordPolicyError } from "../../../../shared/auth/passwordPolicy"
import { register } from "../../utils/api"

function checkLength(str: string) {
    return str.length >= 3 && str.length <= 50
}

export function useRegistrationForm() {
    const navigate = useNavigate()
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [passwordRepeat, setPasswordRepeat] = useState("")
    const [username, setUsername] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)
    const [successText, setSuccessText] = useState(false)
    const [countdown, setCountdown] = useState(3)
    const [fadeOut, setFadeOut] = useState(false)
    const [legalAccepted, setLegalAccepted] = useState(false)

    useEffect(() => {
        if (!successText) return undefined
        const timer = window.setInterval(() => {
            setCountdown((prev) => {
                if (prev <= 1) {
                    window.clearInterval(timer)
                    navigate("/")
                    return 0
                }
                return prev - 1
            })
        }, 1000)
        return () => window.clearInterval(timer)
    }, [successText, navigate])

    const handleRegistration = async () => {
        setError("")
        setLoading(true)
        try {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
            if (!username || !email || !password || !passwordRepeat) {
                setError("Заполните все поля")
                return
            }
            const policyError = passwordPolicyError(password)
            if (
                policyError ||
                !checkLength(username) ||
                username.length > 15 ||
                /[\s\u200B-\u200D\uFEFF]/.test(username) ||
                email.length > 254
            ) {
                setError(policyError || "Проверьте никнейм и почту")
                return
            }
            if (password !== passwordRepeat) {
                setError("Пароли не совпадают")
                return
            }
            if (!emailRegex.test(email)) {
                setError("Введите корректный email")
                return
            }
            if (!legalAccepted) {
                setError("Необходимо принять соглашение и политику конфиденциальности")
                return
            }
            const res = await register(username, email, password)
            if (res && res.user) {
                if (res.verificationRequired) {
                    navigate(`/verify-email?email=${encodeURIComponent(email.trim().toLowerCase())}`)
                    return
                }
                setFadeOut(true)
                window.setTimeout(() => setSuccessText(true), 500)
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setLoading(false)
        }
    }

    return {
        email,
        setEmail,
        password,
        setPassword,
        passwordRepeat,
        setPasswordRepeat,
        username,
        setUsername,
        error,
        loading,
        successText,
        fadeOut,
        countdown,
        legalAccepted,
        setLegalAccepted,
        handleRegistration,
        navigate
    }
}
