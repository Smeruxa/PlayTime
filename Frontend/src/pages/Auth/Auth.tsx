import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { login } from "../../utils/api"
import { useSocket } from "../../server/SocketContext"
import styles from "./Auth.module.css"
import InputText from "../../components/InputText/InputText"
import BlueButton from "../../components/BlueButton/BlueButton"

export default function Auth() {
    const navigate = useNavigate()
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)
    const { setToken } = useSocket()

    const checkLength = (str: string) => {
        return str.length >= 3 && str.length <= 50
    }

    const handleLogin = async () => {
        setLoading(true)
        setError("")
        try {
            if (!checkLength(password) || !checkLength(email)) {
                setError("Поля должны быть от 3 до 50 символов.")
                return
            }
            const res = await login(email, password)
            if (res && res.token) {
                localStorage.setItem("email", email)
                localStorage.setItem("password", password)
                setToken(res.token)
                navigate("/content")
            } else {
                localStorage.removeItem("email")
                localStorage.removeItem("password")
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
                <span className={styles.gradientText}>PlayTime</span>
                <div className={styles.loginForm}>
                    <InputText onChange={val => setEmail(val)} showToggle={false} placeholder="Введите почту" id="email"/>
                    <InputText onChange={val => setPassword(val)} placeholder="Введите пароль" />
                    {error && <div className={styles.error}>{error}</div>}
                    <div className={styles.buttonsWrapper}>
                        <BlueButton text={loading ? "Входим..." : "Войти"} onClick={loading ? ()=>{} : handleLogin} />
                        <BlueButton text="Регистрация" onClick={() => navigate("/registration")} />
                    </div>
                </div>
            </div>
        </div>
    )
}