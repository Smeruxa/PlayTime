import { useNavigate } from "react-router-dom"
import { useState, useEffect } from "react"
import { register } from "../../utils/api/api"
import styles from "./Registration.module.css"
import InputText from "../../components/InputText/InputText"
import BlueButton from "../../components/BlueButton/BlueButton"

export default function Registration() {
    const navigate = useNavigate()
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [username, setUsername] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)
    const [successText, setSuccessText] = useState(false)
    const [countdown, setCountdown] = useState(3)
    const [fadeOut, setFadeOut] = useState(false)

    useEffect(() => {
        if (successText) {
            const timer = setInterval(() => {
                setCountdown(prev => {
                    if (prev <= 1) {
                        clearInterval(timer)
                        navigate("/")
                        return 0
                    }
                    return prev - 1
                })
            }, 1000)
            return () => clearInterval(timer)
        }
    }, [successText, navigate])

    const handleRegistration = async () => {
        setError("")
        setLoading(true)
        try {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
            if (!username || !email || !password) {
                setError("Заполните все поля")
                return
            }
            if (!emailRegex.test(email)) {
                setError("Введите корректный email")
                return
            }
            const res = await register(username, email, password)
            if (res && res.user) {
                setFadeOut(true)
                setTimeout(() => setSuccessText(true), 500)
            }
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className={styles.body}>
            <div className={styles.mainWrapper}>
                <span className={styles.gradientText}>Регистрация</span>
                <div className={styles.loginForm}>
                    <InputText onChange={val => setUsername(val)} showToggle={false} placeholder="Введите никнейм" id="nickname" />
                    <InputText onChange={val => setEmail(val)} showToggle={false} placeholder="Введите почту" id="email" />
                    <InputText onChange={val => setPassword(val)} placeholder="Введите пароль" />
                    {error && <div className={styles.error}>{error}</div>}
                    { successText ? (
                        <BlueButton text={`Успешно! Возвращение через ${countdown} сек.`} />
                    ) : (
                        <div className={`${styles.buttonsWrapper} ${fadeOut ? styles.fadeOut : ""}`}>
                            <BlueButton text={loading ? "Регистрация..." : "Зарегистрироваться"} onClick={loading ? ()=>{} : handleRegistration} />
                            <BlueButton text="Вернуться" onClick={() => navigate("/")} />
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}